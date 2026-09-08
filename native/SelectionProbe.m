#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <dispatch/dispatch.h>
#import <limits.h>
#import <math.h>
#import <signal.h>
#import <stdint.h>
#import <stdlib.h>
#import <string.h>
#import <unistd.h>

// Experimental probe parameters; unrelated to production or AI timeouts.
static const int kPollIntervalMs = 10;
static const int kDefaultSettleDelayMs = 75;
static const float kAXMessageTimeoutSeconds = 0.2f;
static const NSUInteger kTextLogLimit = 512;
static const double kQueryBudgetSeconds = 0.8;
static const NSUInteger kMaxParentLevels = 8;
static const NSUInteger kMaxWindowDepth = 7;
static const NSUInteger kMaxNodes = 64;
static const CFIndex kChildBatchSize = 8;
static const NSUInteger kTargetMaxDepth = 3;
static const NSUInteger kTargetMaxNewNodes = 32;
static const NSUInteger kTargetMaxAttributeChecks = 6;
// Intent threshold in macOS global point coordinates. Retina scaling is not applied.
static const double kDragSelectionThresholdPoints = 4.0;
static BOOL targetContainerMode = NO; // Opt-in command-line experiment, never production.

// One query owns all candidates; no AX elements or selections are cached across samples.
@interface ProbeQuery : NSObject
@property(nonatomic, strong) NSDictionary *sample;
@property(nonatomic, strong) NSMutableDictionary *report;
@property(nonatomic, strong) NSMutableArray<NSDictionary *> *nodes;
@property(nonatomic, strong) NSMutableArray<NSDictionary *> *hitAncestry;
@property(nonatomic) NSUInteger targetInitialNodes;
@property(nonatomic) NSUInteger targetAttributeChecks;
@property(nonatomic, copy) NSString *stopReason;
@property(nonatomic) double startedAt;
@end
@implementation ProbeQuery
@end

// Scheduling state is accessed only on the main queue.
static uint64_t latestSampleId = 0;
static NSDictionary *pendingSample = nil;
static BOOL pendingReady = NO;
static BOOL queryRunning = NO;
static dispatch_queue_t queryQueue;
static volatile sig_atomic_t stopRequested = 0;
static CFMachPortRef mouseEventTap = NULL;
static CFRunLoopSourceRef mouseEventTapSource = NULL;
static uint64_t gestureGenerationCounter = 0;
static uint64_t activeGestureGeneration = 0;
static BOOL trackingLeftGesture = NO;
static BOOL activeGestureDidDrag = NO;
static double activeGestureMaxDragDistance = 0.0;
static int64_t activeGestureClickCount = 0;
static int64_t activeGestureButtonNumber = -1;
static CGPoint activeGestureMouseDown = {0, 0};
static BOOL activeGestureMouseDownAvailable = NO;

static double UpdatedMaxDragDistance(double currentMaximum, CGPoint mouseDown,
    CGPoint draggedPosition) {
  if (!isfinite(currentMaximum) || currentMaximum < 0) return 0.0;
  if (!isfinite(mouseDown.x) || !isfinite(mouseDown.y) ||
      !isfinite(draggedPosition.x) || !isfinite(draggedPosition.y)) {
    return currentMaximum;
  }
  double distance = hypot(draggedPosition.x - mouseDown.x,
      draggedPosition.y - mouseDown.y);
  return isfinite(distance) ? MAX(currentMaximum, distance) : currentMaximum;
}

static int RunGestureDistanceSelfTest(void) {
  CGPoint mouseDown = CGPointMake(10.0, 10.0);
  double maximum = 0.0;
  maximum = UpdatedMaxDragDistance(maximum, mouseDown, CGPointMake(13.0, 14.0));
  maximum = UpdatedMaxDragDistance(maximum, mouseDown, CGPointMake(16.0, 18.0));
  // A later dragged event returning close to mouse-down must not erase the excursion.
  maximum = UpdatedMaxDragDistance(maximum, mouseDown, CGPointMake(10.5, 10.0));
  if (fabs(maximum - 10.0) > 0.0001) {
    fprintf(stderr,
        "[selection-probe] gesture_distance_self_test=failed max=%.3f expected=10.000\n",
        maximum);
    return 1;
  }
  printf("[selection-probe] gesture_distance_self_test=passed max=%.3f\n", maximum);
  return 0;
}

static uint32_t MouseUpCount(void) {
  return CGEventSourceCounterForEventType(
      kCGEventSourceStateCombinedSessionState, kCGEventLeftMouseUp);
}

static void HandleSignal(int signalNumber) {
  (void)signalNumber;
  stopRequested = 1;
}

static NSString *AXErrorName(AXError error) {
  switch (error) {
    case kAXErrorSuccess: return @"success";
    case kAXErrorFailure: return @"failure";
    case kAXErrorIllegalArgument: return @"illegal_argument";
    case kAXErrorInvalidUIElement: return @"invalid_ui_element";
    case kAXErrorCannotComplete: return @"cannot_complete";
    case kAXErrorAttributeUnsupported: return @"attribute_unsupported";
    case kAXErrorNotImplemented: return @"not_implemented";
    case kAXErrorAPIDisabled: return @"api_disabled";
    case kAXErrorNoValue: return @"no_value";
    case kAXErrorParameterizedAttributeUnsupported: return @"parameterized_attribute_unsupported";
    default: return @"other_ax_error";
  }
}

static NSDictionary *ReadResult(NSString *status, id value, NSNumber *error) {
  return @{
    @"status": status,
    @"value": value ?: NSNull.null,
    @"ax_error": error ?: NSNull.null,
    @"ax_error_name": error ? AXErrorName((AXError)error.intValue) : (id)NSNull.null,
  };
}

static id CopyAttribute(AXUIElementRef element, CFStringRef attribute, AXError *error) {
  CFTypeRef rawValue = NULL;
  *error = AXUIElementCopyAttributeValue(element, attribute, &rawValue);
  return CFBridgingRelease(rawValue);
}

static BOOL UnwrapAXValue(id object, AXValueType expectedType, void *destination) {
  if (object == nil || CFGetTypeID((__bridge CFTypeRef)object) != AXValueGetTypeID()) {
    return NO;
  }
  AXValueRef value = (__bridge AXValueRef)object;
  return AXValueGetType(value) == expectedType &&
      AXValueGetValue(value, expectedType, destination);
}

static BOOL FrontmostMatches(NSDictionary *sample) {
  NSRunningApplication *current = NSWorkspace.sharedWorkspace.frontmostApplication;
  NSDictionary *captured = sample[@"app"];
  return current != nil && !current.terminated &&
      current.processIdentifier == [captured[@"pid"] intValue] &&
      [(current.bundleIdentifier ?: (id)NSNull.null) isEqual:captured[@"bundle_id"]];
}

// Check before EVERY potentially blocking AX operation. A call already in progress
// may overrun the total budget by its 200ms messaging timeout; no next call is made.
static BOOL MayQuery(ProbeQuery *query) {
  if (query.stopReason != nil) return NO;
  if (stopRequested) query.stopReason = @"stopping";
  else if (MouseUpCount() != [query.sample[@"mouse_up_counter"] unsignedIntValue])
    query.stopReason = @"superseded_during_query";
  else if (!FrontmostMatches(query.sample)) query.stopReason = @"frontmost_changed_during_query";
  else if (NSProcessInfo.processInfo.systemUptime - query.startedAt >= kQueryBudgetSeconds)
    query.stopReason = @"query_budget_exceeded";
  return query.stopReason == nil;
}

static BOOL IsElement(id value) {
  return value != nil && CFGetTypeID((__bridge CFTypeRef)value) == AXUIElementGetTypeID();
}

static BOOL ContainsElement(NSArray *elements, id element) {
  for (id existing in elements) {
    if (CFEqual((__bridge CFTypeRef)existing, (__bridge CFTypeRef)element)) return YES;
  }
  return NO;
}

static id QueryAttribute(ProbeQuery *query, id element, CFStringRef attribute, AXError *error) {
  *error = kAXErrorSuccess;
  if (!MayQuery(query)) return nil;
  return CopyAttribute((__bridge AXUIElementRef)element, attribute, error);
}

static NSDictionary *QueryReadResult(ProbeQuery *query, AXError error, BOOL valid, id value) {
  // A budget/stale stop is not a fabricated AX error.
  if (query.stopReason != nil) return ReadResult(@"not_queried", nil, nil);
  return ReadResult(error != kAXErrorSuccess ? @"failure" : valid ? @"success" : @"invalid_type",
      valid ? value : nil, @(error));
}

static NSMutableDictionary *NewReport(NSDictionary *sample) {
  NSMutableDictionary *report = [sample mutableCopy];
  report[@"accessibility"] = AXIsProcessTrusted() ? @"trusted" : @"permission_required";
  report[@"diagnostic"] = @"selection_query";
  report[@"selected_text"] = ReadResult(@"not_queried", nil, nil);
  report[@"range"] = ReadResult(@"not_queried", nil, nil);
  report[@"bounds"] = ReadResult(@"not_queried", nil, nil);
  report[@"candidate_source"] = NSNull.null;
  report[@"candidate_role"] = NSNull.null;
  report[@"candidate_depth"] = NSNull.null;
  report[@"hit_test"] = ReadResult(@"not_queried", nil, nil);
  report[@"hit_test_role"] = NSNull.null;
  report[@"hit_test_subrole"] = NSNull.null;
  report[@"parent_roles"] = [NSMutableArray array];
  report[@"candidate_attempts"] = [NSMutableArray array];
  report[@"traversal"] = [NSMutableArray array];
  report[@"nodes_visited"] = @0;
  report[@"usable_selection"] = @NO;
  if (targetContainerMode) {
    report[@"probe_mode"] = @"target_container";
    report[@"target_container_source"] = NSNull.null;
    report[@"target_container_role"] = NSNull.null;
    report[@"target_container_depth"] = NSNull.null;
    report[@"targeted_nodes_visited"] = @0;
    report[@"targeted_stop_reason"] = @"not_run";
    report[@"candidate_attributes_supported"] = ReadResult(@"not_queried", nil, nil);
    report[@"candidate_path"] = NSNull.null;
  }
  return report;
}

// Only the main queue prints, so multi-line sample records cannot interleave.
static void PrintReport(NSMutableDictionary *report, NSString *discardReason) {
  BOOL newerMouseUp = MouseUpCount() != [report[@"mouse_up_counter"] unsignedIntValue];
  BOOL stale = newerMouseUp || [report[@"sampleId"] unsignedLongLongValue] != latestSampleId;
  if (newerMouseUp && discardReason == nil) discardReason = @"new_mouse_up_before_next_poll";
  report[@"stale"] = @(stale);
  report[@"discarded"] = @(discardReason != nil);
  report[@"discard_reason"] = discardReason ?: (id)NSNull.null;
  report[@"elapsed_ms"] = @((NSProcessInfo.processInfo.systemUptime -
      [report[@"captured_at_uptime_seconds"] doubleValue]) * 1000.0);
  if (discardReason != nil) {
    report[@"usable_selection"] = @NO;
    for (NSString *key in @[@"selected_text", @"range", @"bounds"]) {
      NSMutableDictionary *field = [report[key] mutableCopy];
      field[@"read_status"] = field[@"status"];
      field[@"status"] = @"discarded";
      field[@"value"] = NSNull.null;
      report[key] = field;
    }
  }
  NSData *json = [NSJSONSerialization dataWithJSONObject:report
      options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:NULL];
  if (json == nil) {
    fprintf(stderr, "[selection-probe] diagnostic_serialization_failed (text omitted)\n");
    return;
  }
  printf("[selection-probe] sample\n%s\n", [[NSString alloc]
      initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
}

// Metadata only: never fetch title, description, value or document contents.
// Cache by AX identity inside this sample to cap distinct nodes across all paths.
static NSDictionary *InspectNode(ProbeQuery *query, id element) {
  if (!IsElement(element) || !MayQuery(query)) return nil;
  for (NSDictionary *node in query.nodes) {
    if (CFEqual((__bridge CFTypeRef)node[@"element"], (__bridge CFTypeRef)element)) return node;
  }
  if (query.nodes.count >= kMaxNodes) {
    query.stopReason = @"node_limit_reached";
    return nil;
  }
  NSMutableDictionary *node = [@{@"element": element, @"safe": @NO,
      @"role": ReadResult(@"not_queried", nil, nil),
      @"subrole": ReadResult(@"not_queried", nil, nil)} mutableCopy];
  [query.nodes addObject:node];
  query.report[@"nodes_visited"] = @(query.nodes.count);
  pid_t ownerPid = 0;
  AXError error = AXUIElementGetPid((__bridge AXUIElementRef)element, &ownerPid);
  node[@"pid"] = ReadResult(error == kAXErrorSuccess ? @"success" : @"failure", @(ownerPid), @(error));
  if (error != kAXErrorSuccess || ownerPid != [query.sample[@"app"][@"pid"] intValue]) {
    node[@"reason"] = @"candidate_pid_mismatch";
    return node;
  }
  id role = QueryAttribute(query, element, kAXRoleAttribute, &error);
  node[@"role"] = QueryReadResult(query, error, [role isKindOfClass:NSString.class], role);
  if (error != kAXErrorSuccess || ![role isKindOfClass:NSString.class]) {
    node[@"reason"] = @"security_metadata_unavailable";
    return node;
  }
  id subrole = QueryAttribute(query, element, kAXSubroleAttribute, &error);
  BOOL noSubrole = error == kAXErrorAttributeUnsupported || error == kAXErrorNoValue;
  node[@"subrole"] = noSubrole ? ReadResult(@"not_available", nil, @(error)) :
      QueryReadResult(query, error, [subrole isKindOfClass:NSString.class], subrole);
  if (!noSubrole && (error != kAXErrorSuccess || ![subrole isKindOfClass:NSString.class])) {
    node[@"reason"] = @"security_metadata_unavailable";
    return node;
  }
  if ([role isEqual:(__bridge NSString *)kAXSecureTextFieldSubrole] ||
      [subrole isEqual:(__bridge NSString *)kAXSecureTextFieldSubrole]) {
    node[@"reason"] = @"secure_field_skipped";
    return node;
  }
  node[@"safe"] = @YES;
  return node;
}

static BOOL IsSelectionRole(NSString *role) {
  if (role == nil || ![role isKindOfClass:NSString.class]) return NO;
  // AXWebArea is an observed browser role, NOT a private attribute query.
  return [@[@"AXWebArea", (__bridge NSString *)kAXGroupRole,
      (__bridge NSString *)kAXScrollAreaRole, (__bridge NSString *)kAXLayoutAreaRole,
      (__bridge NSString *)kAXSplitGroupRole, (__bridge NSString *)kAXTextFieldRole,
      (__bridge NSString *)kAXTextAreaRole, (__bridge NSString *)kAXStaticTextRole,
      (__bridge NSString *)kAXWindowRole] containsObject:role];
}

static void ReadSelection(ProbeQuery *query, id candidate, NSMutableDictionary *report) {
  AXError error;
  id text = QueryAttribute(query, candidate, kAXSelectedTextAttribute, &error);
  if (error == kAXErrorSuccess && [text isKindOfClass:NSString.class]) {
    NSString *selectedText = text;
    // Escape via JSON; cap logs without reading AXValue/the surrounding document.
    NSRange loggedRange = [selectedText rangeOfComposedCharacterSequencesForRange:
        NSMakeRange(0, MIN(selectedText.length, kTextLogLimit))];
    NSMutableDictionary *textResult = [ReadResult(@"success",
        [selectedText substringWithRange:loggedRange], @(error)) mutableCopy];
    textResult[@"length_utf16"] = @(selectedText.length);
    textResult[@"truncated"] = @(NSMaxRange(loggedRange) < selectedText.length);
    textResult[@"nonempty"] = @(selectedText.length > 0);
    report[@"selected_text"] = textResult;
  } else {
    report[@"selected_text"] = QueryReadResult(query, error, NO, nil);
  }

  // These are independent capability checks, even if selected-text reading failed.
  id rangeValue = QueryAttribute(query, candidate, kAXSelectedTextRangeAttribute, &error);
  CFRange range = CFRangeMake(0, 0);
  if (query.stopReason != nil) return;
  if (error != kAXErrorSuccess) {
    report[@"range"] = ReadResult(@"failure", nil, @(error));
  } else if (!UnwrapAXValue(rangeValue, kAXValueTypeCFRange, &range)) {
    report[@"range"] = ReadResult(@"invalid_type", nil, @(error));
  } else if (range.location < 0 || range.length < 0 || range.length > LONG_MAX - range.location) {
    report[@"range"] = ReadResult(@"invalid_range", nil, @(error));
  } else {
    report[@"range"] = ReadResult(@"success",
        @{@"location": @(range.location), @"length": @(range.length)}, @(error));
    if (range.length == 0) {
      report[@"bounds"] = ReadResult(@"skipped_no_selection", nil, nil);
      return;
    }
    if (!MayQuery(query)) return;
    CFTypeRef rawBounds = NULL;
    error = AXUIElementCopyParameterizedAttributeValue((__bridge AXUIElementRef)candidate,
        kAXBoundsForRangeParameterizedAttribute, (__bridge CFTypeRef)rangeValue, &rawBounds);
    id boundsValue = CFBridgingRelease(rawBounds);
    CGRect bounds = CGRectZero;
    if (error != kAXErrorSuccess) {
      report[@"bounds"] = ReadResult(@"failure", nil, @(error));
    } else if (!UnwrapAXValue(boundsValue, kAXValueTypeCGRect, &bounds)) {
      report[@"bounds"] = ReadResult(@"invalid_type", nil, @(error));
    } else if (!isfinite(bounds.origin.x) || !isfinite(bounds.origin.y) ||
        !isfinite(bounds.size.width) || !isfinite(bounds.size.height) ||
        bounds.size.width <= 0 || bounds.size.height <= 0) {
      report[@"bounds"] = ReadResult(@"invalid_bounds", nil, @(error));
    } else {
      report[@"bounds"] = ReadResult(@"success", @{
        @"x": @(bounds.origin.x), @"y": @(bounds.origin.y),
        @"width": @(bounds.size.width), @"height": @(bounds.size.height),
      }, @(error));
    }
    return;
  }
  report[@"bounds"] = ReadResult(@"skipped_range_unavailable", nil, nil);
}

static BOOL ProbeCandidate(ProbeQuery *query, NSDictionary *node, NSString *source,
    NSUInteger depth, BOOL alwaysProbe) {
  if (node == nil) return NO;
  NSString *role = node[@"role"][@"value"];
  NSMutableDictionary *attempt = [@{@"candidate_source": source,
      @"candidate_role": role ?: (id)NSNull.null, @"candidate_depth": @(depth),
      @"pid": node[@"pid"] ?: ReadResult(@"not_queried", nil, nil),
      @"role": node[@"role"], @"subrole": node[@"subrole"]} mutableCopy];
  if ([source isEqual:@"targeted_container_search"]) {
    attempt[@"candidate_path"] = node[@"target_path"];
    attempt[@"candidate_attributes_supported"] = node[@"target_attributes"];
    attempt[@"focused"] = node[@"target_focused"];
    query.report[@"candidate_path"] = node[@"target_path"];
    query.report[@"candidate_attributes_supported"] = node[@"target_attributes"];
  }
  [query.report[@"candidate_attempts"] addObject:attempt];
  if (![node[@"safe"] boolValue] || ![role isKindOfClass:NSString.class]) {
    attempt[@"diagnostic"] = node[@"reason"] ?: @"unsafe_candidate";
    return NO;
  }
  if ((!alwaysProbe && !IsSelectionRole(role)) || [node[@"probed"] boolValue]) {
    attempt[@"diagnostic"] = [node[@"probed"] boolValue] ? @"already_probed" : @"not_selection_role";
    return NO;
  }
  if (!MayQuery(query)) return NO;
  ((NSMutableDictionary *)node)[@"probed"] = @YES;
  NSMutableDictionary *selection = [NSMutableDictionary dictionary];
  for (NSString *key in @[@"selected_text", @"range", @"bounds"])
    selection[key] = ReadResult(@"not_queried", nil, nil);
  ReadSelection(query, node[@"element"], selection);
  BOOL useful = [selection[@"selected_text"][@"nonempty"] boolValue];
  // Attempts retain capability/error metadata, never text or range/bounds values.
  for (NSString *key in selection) {
    NSMutableDictionary *summary = [selection[key] mutableCopy];
    [summary removeObjectForKey:@"value"];
    attempt[key] = summary;
    query.report[key] = selection[key];
  }
  attempt[@"diagnostic"] = useful ? @"nonempty_selection_read" : @"no_usable_selection";
  query.report[@"candidate_source"] = source;
  query.report[@"candidate_role"] = role;
  query.report[@"candidate_depth"] = @(depth);
  query.report[@"usable_selection"] = @(useful);
  return useful;
}

static BOOL TryHitTest(ProbeQuery *query, id application) {
  NSDictionary *mouse = query.sample[@"mouse"];
  if (![mouse[@"available"] boolValue]) {
    query.report[@"hit_test"] = ReadResult(@"mouse_unavailable", nil, nil);
    return NO;
  }
  if (!MayQuery(query)) return NO;
  AXUIElementRef rawHit = NULL;
  // Restrict the documented screen-coordinate hit test to the captured app.
  AXError error = AXUIElementCopyElementAtPosition((__bridge AXUIElementRef)application,
      [mouse[@"position"][@"x"] floatValue], [mouse[@"position"][@"y"] floatValue], &rawHit);
  id hit = CFBridgingRelease(rawHit);
  query.report[@"hit_test"] = QueryReadResult(query, error, IsElement(hit), nil);
  if (error != kAXErrorSuccess || !IsElement(hit)) return NO;
  NSMutableArray *chain = [NSMutableArray array];
  id current = hit;
  for (NSUInteger depth = 0; depth <= kMaxParentLevels && MayQuery(query); depth++) {
    if (ContainsElement(chain, current)) {
      query.report[@"parent_walk_stop"] = @"cycle_detected";
      break;
    }
    [chain addObject:current];
    NSDictionary *node = InspectNode(query, current);
    if (node == nil) break;
    if (targetContainerMode)
      [query.hitAncestry addObject:@{@"node": node, @"depth": @(depth)}];
    if (depth == 0) {
      query.report[@"hit_test_role"] = node[@"role"][@"value"];
      query.report[@"hit_test_subrole"] = node[@"subrole"][@"value"];
      query.report[@"hit_test_pid"] = node[@"pid"];
    } else {
      [query.report[@"parent_roles"] addObject:@{@"depth": @(depth),
          @"role": node[@"role"], @"subrole": node[@"subrole"]}];
    }
    if (ProbeCandidate(query, node, depth == 0 ? @"hit_test" : @"parent_walk", depth, NO)) return YES;
    if (![node[@"safe"] boolValue]) {
      // Never climb out of a secure/unverifiable target and read its ancestors.
      query.stopReason = query.stopReason ?: node[@"reason"];
      break;
    }
    if ([node[@"role"][@"value"] isEqual:(__bridge NSString *)kAXWindowRole]) break;
    if (depth == kMaxParentLevels) {
      query.report[@"parent_walk_stop"] = @"depth_limit_reached";
      break;
    }
    id parent = QueryAttribute(query, current, kAXParentAttribute, &error);
    [query.report[@"traversal"] addObject:@{@"source": @"parent_walk", @"depth": @(depth),
        @"attribute": @"AXParent", @"result": QueryReadResult(query, error, IsElement(parent), nil)}];
    if (error != kAXErrorSuccess || !IsElement(parent)) break;
    current = parent;
  }
  return NO;
}

static BOOL TryWindowSearch(ProbeQuery *query, id application) {
  AXError error;
  id window = QueryAttribute(query, application, kAXFocusedWindowAttribute, &error);
  query.report[@"focused_window"] = QueryReadResult(query, error, IsElement(window), nil);
  if (!IsElement(window) || error != kAXErrorSuccess) {
    window = QueryAttribute(query, application, kAXMainWindowAttribute, &error);
    query.report[@"main_window"] = QueryReadResult(query, error, IsElement(window), nil);
  }
  if (error != kAXErrorSuccess || !IsElement(window) || !MayQuery(query)) return NO;
  // No AXWindows lookup: never search a different/background window.
  NSMutableArray *queue = [NSMutableArray arrayWithObject:@{@"element": window, @"depth": @0}];
  NSMutableArray *scheduled = [NSMutableArray arrayWithObject:window];
  for (NSUInteger index = 0; index < queue.count && MayQuery(query); index++) {
    NSDictionary *entry = queue[index];
    id element = entry[@"element"];
    NSUInteger depth = [entry[@"depth"] unsignedIntegerValue];
    NSDictionary *node = InspectNode(query, element);
    if (node == nil) break;
    if (depth > 0 && [node[@"role"][@"value"] isEqual:(__bridge NSString *)kAXWindowRole]) {
      query.report[@"nested_window_skipped"] = @YES;
      continue;
    }
    if (ProbeCandidate(query, node, @"bounded_window_search", depth, NO)) return YES;
    if (![node[@"safe"] boolValue]) continue; // Skip this entire branch, including secure fields.
    if (depth >= kMaxWindowDepth) {
      query.report[@"window_depth_limit_reached"] = @YES;
      continue;
    }
    // Public container relationships only, paginated; no whole AXChildren arrays.
    for (NSString *attribute in @[(__bridge NSString *)kAXContentsAttribute,
        (__bridge NSString *)kAXChildrenAttribute]) {
      if (!MayQuery(query)) return NO;
      CFIndex count = 0;
      error = AXUIElementGetAttributeValueCount((__bridge AXUIElementRef)element,
          (__bridge CFStringRef)attribute, &count);
      [query.report[@"traversal"] addObject:@{@"source": @"bounded_window_search",
          @"depth": @(depth), @"attribute": attribute, @"operation": @"count",
          @"result": ReadResult(error == kAXErrorSuccess ? @"success" : @"failure", @(count), @(error))}];
      if (error != kAXErrorSuccess || count < 0) continue;
      // Also bound scanning duplicate/invalid entries in a single child list.
      CFIndex scanLimit = MIN(count, (CFIndex)kMaxNodes);
      if (count > scanLimit) query.report[@"child_list_truncated"] = @YES;
      for (CFIndex offset = 0; offset < scanLimit; offset += kChildBatchSize) {
        if (scheduled.count >= kMaxNodes) {
          query.report[@"window_queue_limit_reached"] = @YES;
          break;
        }
        if (!MayQuery(query)) return NO;
        CFIndex requested = MIN(kChildBatchSize, scanLimit - offset);
        CFArrayRef rawChildren = NULL;
        error = AXUIElementCopyAttributeValues((__bridge AXUIElementRef)element,
            (__bridge CFStringRef)attribute, offset, requested, &rawChildren);
        id children = CFBridgingRelease(rawChildren);
        BOOL valid = [children isKindOfClass:NSArray.class] && [children count] <= (NSUInteger)requested;
        [query.report[@"traversal"] addObject:@{@"source": @"bounded_window_search",
            @"depth": @(depth), @"attribute": attribute, @"operation": @"batch", @"offset": @(offset),
            @"requested": @(requested), @"result": QueryReadResult(query, error, valid, nil)}];
        if (error != kAXErrorSuccess || !valid) break;
        for (id child in children) {
          if (!IsElement(child)) continue;
          if (ContainsElement(scheduled, child)) {
            query.report[@"window_repeated_nodes_skipped"] = @YES;
            continue;
          }
          if (scheduled.count >= kMaxNodes) break;
          [scheduled addObject:child];
          [queue addObject:@{@"element": child, @"depth": @(depth + 1)}];
        }
      }
    }
  }
  return NO;
}

// Everything below this boundary is used only by --target-container. The normal
// window search and already-successful focused/hit paths keep their old behavior.
static BOOL MayTargetQuery(ProbeQuery *query) {
  if (!MayQuery(query)) {
    query.report[@"targeted_stop_reason"] = query.stopReason;
    return NO;
  }
  return [query.report[@"targeted_stop_reason"] isEqual:@"searching"];
}

static NSDictionary *TargetInspectNode(ProbeQuery *query, id element) {
  if (!MayTargetQuery(query) || !IsElement(element)) return nil;
  BOOL known = NO;
  for (NSDictionary *node in query.nodes) {
    if (CFEqual((__bridge CFTypeRef)node[@"element"], (__bridge CFTypeRef)element)) known = YES;
  }
  if (!known && query.nodes.count - query.targetInitialNodes >= kTargetMaxNewNodes) {
    // Stop discovering new nodes, but allow already-prepared candidates to be
    // queried within the remaining time budget instead of discarding the queue.
    query.report[@"targeted_node_limit_reached"] = @YES;
    return nil;
  }
  if (!known && query.nodes.count >= kMaxNodes) {
    query.report[@"targeted_global_node_limit_reached"] = @YES;
    return nil;
  }
  NSDictionary *node = InspectNode(query, element);
  query.report[@"targeted_nodes_visited"] = @(query.nodes.count - query.targetInitialNodes);
  if (query.stopReason) query.report[@"targeted_stop_reason"] = query.stopReason;
  return node;
}

static id TargetCurrentWindow(ProbeQuery *query, id application) {
  AXError error;
  id window = QueryAttribute(query, application, kAXFocusedWindowAttribute, &error);
  query.report[@"target_focused_window"] = QueryReadResult(query, error, IsElement(window), nil);
  if (error == kAXErrorNoValue || error == kAXErrorAttributeUnsupported) {
    window = QueryAttribute(query, application, kAXMainWindowAttribute, &error);
    query.report[@"target_main_window"] = QueryReadResult(query, error, IsElement(window), nil);
  }
  return error == kAXErrorSuccess && IsElement(window) ? window : nil;
}

static NSDictionary *FindTargetContainer(ProbeQuery *query, id application, id *currentWindow) {
  if (query.hitAncestry.count == 0) {
    query.report[@"target_container_check"] = @"no_hit_ancestry";
    return nil;
  }
  id window = TargetCurrentWindow(query, application);
  NSDictionary *windowNode = TargetInspectNode(query, window);
  if (![windowNode[@"safe"] boolValue] ||
      ![windowNode[@"role"][@"value"] isEqual:(__bridge NSString *)kAXWindowRole]) {
    query.report[@"target_container_check"] = @"current_window_unverifiable";
    return nil;
  }
  BOOL chainReachesWindow = NO;
  NSDictionary *preferred = nil, *local = nil;
  for (NSDictionary *entry in query.hitAncestry) {
    NSDictionary *node = entry[@"node"];
    if (![node[@"safe"] boolValue]) return nil;
    NSString *role = node[@"role"][@"value"];
    if ([role isEqual:(__bridge NSString *)kAXWindowRole]) {
      if (!CFEqual((__bridge CFTypeRef)node[@"element"], (__bridge CFTypeRef)window)) {
        query.report[@"target_container_check"] = @"ancestry_window_mismatch";
        return nil;
      }
      chainReachesWindow = YES;
      break;
    }
    // Ancestry is ordered nearest-first. Prefer its nearest WebArea, otherwise
    // its nearest local container. Never choose a sibling, another tab or window.
    if (!preferred && [role isEqual:@"AXWebArea"]) preferred = entry;
    if (!local && [@[(__bridge NSString *)kAXGroupRole,
        (__bridge NSString *)kAXScrollAreaRole, (__bridge NSString *)kAXLayoutAreaRole,
        (__bridge NSString *)kAXTextAreaRole] containsObject:role]) local = entry;
  }
  NSDictionary *chosen = preferred ?: local;
  if (!chosen) {
    query.report[@"target_container_check"] = @"no_local_container_role";
    return nil;
  }
  AXError error;
  id ownerWindow = QueryAttribute(query, chosen[@"node"][@"element"], kAXWindowAttribute, &error);
  query.report[@"target_window_relation"] = QueryReadResult(query, error, IsElement(ownerWindow), nil);
  BOOL directMatch = error == kAXErrorSuccess && IsElement(ownerWindow) &&
      CFEqual((__bridge CFTypeRef)ownerWindow, (__bridge CFTypeRef)window);
  BOOL absent = error == kAXErrorNoValue || error == kAXErrorAttributeUnsupported;
  if (!directMatch && !(absent && chainReachesWindow)) {
    query.report[@"target_container_check"] = @"container_window_unverifiable_or_mismatched";
    return nil;
  }
  *currentWindow = window;
  query.report[@"target_container_check"] = directMatch ? @"AXWindow_matches" : @"parent_chain_matches";
  query.report[@"target_container_source"] = [chosen[@"depth"] unsignedIntegerValue] == 0 ? @"hit_test" : @"parent_walk";
  query.report[@"target_container_role"] = chosen[@"node"][@"role"][@"value"];
  query.report[@"target_container_depth"] = chosen[@"depth"];
  return chosen[@"node"];
}

static BOOL IsTextRole(NSString *role) {
  return role != nil && [@[(__bridge NSString *)kAXTextFieldRole,
      (__bridge NSString *)kAXTextAreaRole, (__bridge NSString *)kAXStaticTextRole] containsObject:role];
}

static NSMutableDictionary *PrepareTargetCandidate(ProbeQuery *query, NSDictionary *node, NSArray *path) {
  NSMutableDictionary *candidate = [node mutableCopy];
  candidate[@"target_path"] = path;
  candidate[@"target_attributes"] = ReadResult(@"not_queried", nil, nil);
  candidate[@"target_focused"] = ReadResult(@"not_queried", nil, nil);
  candidate[@"target_priority"] = @4;
  candidate[@"target_eligible"] = @NO;
  if (![node[@"safe"] boolValue] || !MayTargetQuery(query)) return candidate;
  AXError error;
  id focusedValue = QueryAttribute(query, node[@"element"], kAXFocusedAttribute, &error);
  BOOL validFocus = focusedValue != nil && CFGetTypeID((__bridge CFTypeRef)focusedValue) == CFBooleanGetTypeID();
  candidate[@"target_focused"] = QueryReadResult(query, error, validFocus, validFocus ? focusedValue : nil);
  BOOL focused = error == kAXErrorSuccess && validFocus && [focusedValue boolValue];
  NSString *role = node[@"role"][@"value"];
  BOOL knownRole = IsSelectionRole(role), advertised = NO;
  if (!knownRole && ![node[@"probed"] boolValue] && MayTargetQuery(query)) {
    if (query.targetAttributeChecks < kTargetMaxAttributeChecks) {
      query.targetAttributeChecks++;
      CFArrayRef rawNames = NULL;
      error = AXUIElementCopyAttributeNames((__bridge AXUIElementRef)node[@"element"], &rawNames);
      id names = CFBridgingRelease(rawNames);
      BOOL valid = [names isKindOfClass:NSArray.class] && [names count] <= 512;
      NSMutableArray *standard = [NSMutableArray array];
      if (error == kAXErrorSuccess && valid) {
        // Report only these public names, never dump all attributes or read any
        // private names that a provider may include in its advertised name list.
        for (NSString *name in @[(__bridge NSString *)kAXSelectedTextAttribute,
            (__bridge NSString *)kAXSelectedTextRangeAttribute]) {
          if ([names containsObject:name]) [standard addObject:name];
        }
        advertised = standard.count > 0;
      }
      candidate[@"target_attributes"] = QueryReadResult(query, error, valid, standard);
    } else {
      candidate[@"target_attributes"] = ReadResult(@"attribute_check_limit_reached", nil, nil);
    }
  }
  candidate[@"target_eligible"] = @(knownRole || advertised);
  candidate[@"target_priority"] = @(focused ? 0 : IsTextRole(role) ? 1 : advertised ? 2 : knownRole ? 3 : 4);
  query.report[@"target_attribute_checks"] = @(query.targetAttributeChecks);
  return candidate;
}

static void EnqueueTargetChildren(ProbeQuery *query, NSDictionary *entry,
    NSMutableArray *queue, NSMutableArray *scheduled) {
  NSUInteger depth = [entry[@"depth"] unsignedIntegerValue];
  if (depth >= kTargetMaxDepth) {
    query.report[@"targeted_depth_limit_reached"] = @YES;
    return;
  }
  for (NSString *attribute in @[(__bridge NSString *)kAXContentsAttribute,
      (__bridge NSString *)kAXChildrenAttribute]) {
    if (!MayTargetQuery(query)) return;
    CFIndex count = 0;
    AXError error = AXUIElementGetAttributeValueCount((__bridge AXUIElementRef)entry[@"node"][@"element"],
        (__bridge CFStringRef)attribute, &count);
    [query.report[@"traversal"] addObject:@{@"source": @"targeted_container_search", @"path": entry[@"path"],
        @"attribute": attribute, @"operation": @"count", @"result": ReadResult(error == kAXErrorSuccess ? @"success" : @"failure", @(count), @(error))}];
    if (error != kAXErrorSuccess || count < 0) continue;
    CFIndex scanLimit = MIN(count, (CFIndex)kTargetMaxNewNodes);
    if (count > scanLimit) query.report[@"targeted_child_list_truncated"] = @YES;
    for (CFIndex offset = 0; offset < scanLimit; offset += kChildBatchSize) {
      if (scheduled.count >= kMaxNodes) {
        query.report[@"targeted_queue_limit_reached"] = @YES;
        return;
      }
      if (!MayTargetQuery(query)) return;
      CFIndex requested = MIN(kChildBatchSize, scanLimit - offset);
      CFArrayRef rawChildren = NULL;
      error = AXUIElementCopyAttributeValues((__bridge AXUIElementRef)entry[@"node"][@"element"],
          (__bridge CFStringRef)attribute, offset, requested, &rawChildren);
      id children = CFBridgingRelease(rawChildren);
      BOOL valid = [children isKindOfClass:NSArray.class] && [children count] <= (NSUInteger)requested;
      [query.report[@"traversal"] addObject:@{@"source": @"targeted_container_search", @"path": entry[@"path"],
          @"attribute": attribute, @"operation": @"batch", @"offset": @(offset), @"requested": @(requested),
          @"result": QueryReadResult(query, error, valid, nil)}];
      if (error != kAXErrorSuccess || !valid) break;
      NSUInteger childIndex = 0;
      for (id child in children) {
        CFIndex absoluteIndex = offset + (CFIndex)childIndex++;
        if (!IsElement(child)) continue;
        if (ContainsElement(scheduled, child)) {
          query.report[@"targeted_repeated_nodes_skipped"] = @YES;
          continue;
        }
        if (scheduled.count >= kMaxNodes) return;
        NSDictionary *node = TargetInspectNode(query, child);
        if (!node) return;
        [scheduled addObject:child];
        NSString *step = [NSString stringWithFormat:@"%@[%ld]:%@", attribute, (long)absoluteIndex, node[@"role"][@"value"]];
        NSArray *path = [entry[@"path"] arrayByAddingObject:step];
        // Never enter a nested window or application, even if the child list points there.
        id role = node[@"role"][@"value"];
        if ([role isEqual:(__bridge NSString *)kAXWindowRole] ||
            [role isEqual:(__bridge NSString *)kAXApplicationRole]) {
          query.report[@"targeted_foreign_root_skipped"] = @YES;
          continue;
        }
        NSMutableDictionary *candidate = PrepareTargetCandidate(query, node, path);
        [queue addObject:@{@"node": candidate, @"depth": @(depth + 1), @"path": path}];
      }
    }
  }
}

static BOOL TryTargetContainer(ProbeQuery *query, id application) {
  query.targetInitialNodes = query.nodes.count;
  query.report[@"targeted_stop_reason"] = @"searching";
  id window = nil;
  NSDictionary *root = FindTargetContainer(query, application, &window);
  if (!root || !MayTargetQuery(query)) {
    query.report[@"targeted_stop_reason"] = query.stopReason ?: @"target_container_unavailable";
    return NO;
  }
  NSArray *rootPath = @[root[@"role"][@"value"]];
  NSMutableArray *queue = [NSMutableArray arrayWithObject:@{@"node": PrepareTargetCandidate(query, root, rootPath),
      @"depth": @0, @"path": rootPath}];
  NSMutableArray *scheduled = [NSMutableArray arrayWithObject:root[@"element"]];
  while (queue.count > 0 && MayTargetQuery(query)) {
    // Stable best-first ordering among discovered candidates, not a full-tree sort.
    NSUInteger best = 0;
    for (NSUInteger i = 1; i < queue.count; i++) {
      if ([queue[i][@"node"][@"target_priority"] intValue] < [queue[best][@"node"][@"target_priority"] intValue]) best = i;
    }
    NSDictionary *entry = queue[best];
    [queue removeObjectAtIndex:best];
    NSDictionary *node = entry[@"node"];
    if (![node[@"safe"] boolValue]) {
      ProbeCandidate(query, node, @"targeted_container_search", [entry[@"depth"] unsignedIntegerValue], YES);
      continue;
    }
    // An explicit conflicting window relationship invalidates the branch. An
    // absent optional relation may rely on the verified container's child path.
    AXError error;
    id owner = QueryAttribute(query, node[@"element"], kAXWindowAttribute, &error);
    BOOL absent = error == kAXErrorNoValue || error == kAXErrorAttributeUnsupported;
    if (!absent && !(error == kAXErrorSuccess && IsElement(owner) &&
        CFEqual((__bridge CFTypeRef)owner, (__bridge CFTypeRef)window))) {
      query.report[@"targeted_branch_window_rejected"] = @YES;
      continue;
    }
    BOOL eligible = [node[@"target_eligible"] boolValue];
    BOOL found = ProbeCandidate(query, node, @"targeted_container_search", [entry[@"depth"] unsignedIntegerValue], eligible);
    if (found) {
      id nowWindow = TargetCurrentWindow(query, application);
      BOOL sameWindow = nowWindow && CFEqual((__bridge CFTypeRef)nowWindow, (__bridge CFTypeRef)window);
      if (!sameWindow || !MayTargetQuery(query)) {
        query.report[@"usable_selection"] = @NO;
        // Do not publish text whose current-window ownership cannot be confirmed.
        for (NSString *key in @[@"selected_text", @"range", @"bounds"])
          query.report[key] = ReadResult(@"discarded", nil, nil);
        query.report[@"targeted_stop_reason"] = query.stopReason ?: @"target_window_changed_or_unverifiable";
        return NO;
      }
      query.report[@"targeted_stop_reason"] = @"selection_found_verify_manually";
      return YES;
    }
    EnqueueTargetChildren(query, entry, queue, scheduled);
  }
  if (query.stopReason) query.report[@"targeted_stop_reason"] = query.stopReason;
  else if ([query.report[@"targeted_stop_reason"] isEqual:@"searching"])
    query.report[@"targeted_stop_reason"] = [query.report[@"targeted_global_node_limit_reached"] boolValue] ? @"node_limit_reached" :
        [query.report[@"targeted_node_limit_reached"] boolValue] ? @"targeted_node_limit_reached" :
        [query.report[@"targeted_depth_limit_reached"] boolValue] ? @"targeted_depth_limit_reached" : @"no_usable_selection_in_target";
  return NO;
}

static NSMutableDictionary *QuerySelection(NSDictionary *sample) {
  NSMutableDictionary *report = NewReport(sample);
  if (![report[@"accessibility"] isEqual:@"trusted"]) {
    report[@"diagnostic"] = @"permission_required";
    return report;
  }
  pid_t pid = [sample[@"app"][@"pid"] intValue];
  if (pid <= 0 || pid == getpid()) {
    report[@"diagnostic"] = @"no_external_application";
    return report;
  }
  ProbeQuery *query = [ProbeQuery new];
  query.sample = sample;
  query.report = report;
  query.nodes = [NSMutableArray array];
  if (targetContainerMode) query.hitAncestry = [NSMutableArray array];
  query.startedAt = NSProcessInfo.processInfo.systemUptime;
  if (!MayQuery(query)) {
    report[@"diagnostic"] = query.stopReason;
    report[@"query_stop_reason"] = query.stopReason;
    return report;
  }
  AXUIElementRef systemWide = AXUIElementCreateSystemWide();
  if (systemWide == NULL) {
    report[@"diagnostic"] = @"ax_allocation_failed";
    return report;
  }
  AXError error = AXUIElementSetMessagingTimeout(systemWide, kAXMessageTimeoutSeconds);
  CFRelease(systemWide);
  report[@"timeout_setup"] = ReadResult(error == kAXErrorSuccess ? @"success" : @"failure",
      @(kAXMessageTimeoutSeconds), @(error));
  if (error != kAXErrorSuccess) {
    report[@"diagnostic"] = @"timeout_setup_failed";
    return report;
  }
  id application = CFBridgingRelease(AXUIElementCreateApplication(pid));
  if (application == nil) {
    report[@"diagnostic"] = @"ax_allocation_failed";
    return report;
  }
  id focused = QueryAttribute(query, application, kAXFocusedUIElementAttribute, &error);
  report[@"focused_element"] = QueryReadResult(query, error, IsElement(focused), nil);
  BOOL found = NO;
  if (error == kAXErrorSuccess && IsElement(focused)) {
    NSDictionary *node = InspectNode(query, focused);
    if (node != nil) {
      report[@"focused_pid"] = node[@"pid"];
      report[@"role"] = node[@"role"];
      report[@"subrole"] = node[@"subrole"];
      found = ProbeCandidate(query, node, @"focused_element", 0, YES);
      // Preserve fail-closed behavior for secure/unverifiable focused fields.
      if (![node[@"safe"] boolValue]) query.stopReason = query.stopReason ?: node[@"reason"];
    }
  }
  if (!found && MayQuery(query)) found = TryHitTest(query, application);
  if (!found && MayQuery(query)) {
    found = targetContainerMode ? TryTargetContainer(query, application) : TryWindowSearch(query, application);
  }
  // Recheck even on success; the print boundary also checks raw mouse counter/app.
  MayQuery(query);
  report[@"query_elapsed_ms"] = @((NSProcessInfo.processInfo.systemUptime - query.startedAt) * 1000);
  report[@"query_stop_reason"] = query.stopReason ?: (id)NSNull.null;
  report[@"diagnostic"] = found ? @"nonempty_selection_read_verify_manually" :
      (query.stopReason ?: @"no_usable_selection");
  if (targetContainerMode && !found && !query.stopReason &&
      ![report[@"targeted_stop_reason"] isEqual:@"not_run"])
    report[@"diagnostic"] = report[@"targeted_stop_reason"];
  return report;
}

static void StartPendingQuery(void) {
  if (stopRequested || queryRunning || !pendingReady || pendingSample == nil) return;
  NSDictionary *sample = pendingSample;
  pendingSample = nil;
  pendingReady = NO;
  if (MouseUpCount() != [sample[@"mouse_up_counter"] unsignedIntValue]) {
    PrintReport(NewReport(sample), @"new_mouse_up_before_query");
    return;
  }
  if (!FrontmostMatches(sample)) {
    PrintReport(NewReport(sample), @"frontmost_changed_before_query");
    return;
  }
  queryRunning = YES;
  dispatch_async(queryQueue, ^{
    @autoreleasepool {
      NSMutableDictionary *report = QuerySelection(sample);
      dispatch_async(dispatch_get_main_queue(), ^{
        queryRunning = NO;
        if (stopRequested) return;
        NSString *discardReason = nil;
        NSString *queryStop = report[@"query_stop_reason"];
        if ([queryStop isEqual:@"superseded_during_query"] ||
            [queryStop isEqual:@"frontmost_changed_during_query"]) {
          discardReason = queryStop;
        } else if ([sample[@"sampleId"] unsignedLongLongValue] != latestSampleId) {
          discardReason = @"superseded_during_query";
        } else if (!FrontmostMatches(sample)) {
          discardReason = @"frontmost_changed_during_query";
        }
        PrintReport(report, discardReason);
        StartPendingQuery();
      });
    }
  });
}

static void CaptureMouseUp(uint32_t counter, uint32_t observedCount, int settleDelayMs,
    CGPoint mouse, BOOL mouseAvailable, BOOL mouseApproximate, NSDictionary *gesture) {
  uint64_t sampleId = ++latestSampleId;
  NSRunningApplication *application = NSWorkspace.sharedWorkspace.frontmostApplication;
  NSDictionary *sample = @{
    @"sampleId": @(sampleId),
    @"captured_at_uptime_seconds": @(NSProcessInfo.processInfo.systemUptime),
    @"observed_mouse_ups": @(observedCount),
    @"mouse_up_counter": @(counter),
    @"app": @{
      @"name": application.localizedName ?: application.bundleIdentifier ?: @"Unknown",
      @"pid": @(application ? application.processIdentifier : 0),
      @"bundle_id": application.bundleIdentifier ?: (id)NSNull.null,
    },
    @"mouse": @{
      @"available": @(mouseAvailable),
      @"approximate": @(mouseApproximate),
      @"coordinate_space": @"global_display_top_left",
      @"position": mouseAvailable ? @{@"x": @(mouse.x), @"y": @(mouse.y)} : (id)NSNull.null,
    },
    @"gesture": gesture,
    @"bounds_coordinate_space": @"ax_global_screen_top_left_points",
  };
  if (pendingSample != nil) {
    PrintReport(NewReport(pendingSample), @"superseded_before_query");
  }
  pendingSample = sample;
  pendingReady = NO;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)settleDelayMs * NSEC_PER_MSEC),
      dispatch_get_main_queue(), ^{
    if ([pendingSample[@"sampleId"] unsignedLongLongValue] == sampleId) {
      pendingReady = YES;
      StartPendingQuery();
    }
  });
}

static NSDictionary *GestureReport(uint64_t generation, int64_t clickCount, BOOL didDrag,
    double maxDragDistance, BOOL complete, CGPoint mouseDown, BOOL mouseDownAvailable) {
  return @{
    @"button": @"left",
    @"generation": @(generation),
    @"clickCount": @(MAX((int64_t)0, clickCount)),
    @"didDrag": @(didDrag),
    @"maxDragDistance": @(MAX(0.0, maxDragDistance)),
    @"complete": @(complete),
    @"mouseDownPosition": mouseDownAvailable
        ? @{@"x": @(mouseDown.x), @"y": @(mouseDown.y)}
        : (id)NSNull.null,
  };
}

static CGEventRef ObserveMouseGesture(CGEventTapProxy proxy, CGEventType type,
    CGEventRef event, void *userInfo) {
  (void)proxy;
  int settleDelayMs = *(int *)userInfo;
  @autoreleasepool {
    if (type == kCGEventTapDisabledByTimeout ||
        type == kCGEventTapDisabledByUserInput) {
      if (mouseEventTap != NULL) CGEventTapEnable(mouseEventTap, true);
      return event;
    }
    if (type == kCGEventLeftMouseDown) {
      trackingLeftGesture = YES;
      activeGestureDidDrag = NO;
      activeGestureMaxDragDistance = 0.0;
      activeGestureGeneration = ++gestureGenerationCounter;
      activeGestureClickCount = CGEventGetIntegerValueField(event, kCGMouseEventClickState);
      activeGestureButtonNumber = CGEventGetIntegerValueField(event, kCGMouseEventButtonNumber);
      activeGestureMouseDown = CGEventGetLocation(event);
      activeGestureMouseDownAvailable = isfinite(activeGestureMouseDown.x) &&
          isfinite(activeGestureMouseDown.y);
      return event;
    }
    if (type == kCGEventLeftMouseDragged) {
      if (trackingLeftGesture) {
        activeGestureDidDrag = YES;
        if (activeGestureMouseDownAvailable) {
          activeGestureMaxDragDistance = UpdatedMaxDragDistance(
              activeGestureMaxDragDistance, activeGestureMouseDown,
              CGEventGetLocation(event));
        }
      }
      return event;
    }
    if (type != kCGEventLeftMouseUp) return event;

    CGPoint mouseUp = CGEventGetLocation(event);
    BOOL mouseUpAvailable = isfinite(mouseUp.x) && isfinite(mouseUp.y);
    int64_t upClickCount = CGEventGetIntegerValueField(event, kCGMouseEventClickState);
    int64_t upButtonNumber = CGEventGetIntegerValueField(event, kCGMouseEventButtonNumber);
    int64_t clickCount = MAX(activeGestureClickCount, upClickCount);
    BOOL complete = trackingLeftGesture && activeGestureGeneration > 0 &&
        activeGestureButtonNumber == kCGMouseButtonLeft &&
        upButtonNumber == kCGMouseButtonLeft;
    uint64_t generation = complete ? activeGestureGeneration : ++gestureGenerationCounter;
    NSDictionary *gesture = GestureReport(generation, clickCount,
        complete && activeGestureDidDrag,
        complete ? activeGestureMaxDragDistance : 0.0, complete, activeGestureMouseDown,
        complete && activeGestureMouseDownAvailable);

    trackingLeftGesture = NO;
    activeGestureDidDrag = NO;
    activeGestureMaxDragDistance = 0.0;
    activeGestureGeneration = 0;
    activeGestureClickCount = 0;
    activeGestureButtonNumber = -1;
    activeGestureMouseDownAvailable = NO;

    // Keep the event-tap callback nonblocking. Capturing on the main queue also
    // lets the public event counter settle after this callback returns, so the
    // existing stale-query guard records the same completed mouse-up.
    dispatch_async(dispatch_get_main_queue(), ^{
      CaptureMouseUp(MouseUpCount(), 1, settleDelayMs, mouseUp,
          mouseUpAvailable, NO, gesture);
    });
  }
  return event;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    int settleDelayMs = kDefaultSettleDelayMs;
    BOOL delayProvided = NO, showHelp = NO, runGestureDistanceSelfTest = NO;
    // Parse all options before reading trust/counters. The default mode is unchanged.
    for (int index = 1; index < argc; index++) {
      if (strcmp(argv[index], "--help") == 0 && !showHelp) { showHelp = YES; continue; }
      if (strcmp(argv[index], "--target-container") == 0 && !targetContainerMode) {
        targetContainerMode = YES;
        continue;
      }
      if (strcmp(argv[index], "--self-test-gesture-distance") == 0 &&
          !runGestureDistanceSelfTest) {
        runGestureDistanceSelfTest = YES;
        continue;
      }
      if (strcmp(argv[index], "--delay-ms") == 0 && !delayProvided && index + 1 < argc) {
        const char *value = argv[++index];
        char *end = NULL;
        long parsed = strtol(value, &end, 10);
        if (end != value && *end == '\0' && parsed >= 10 && parsed <= 1000) {
          settleDelayMs = (int)parsed;
          delayProvided = YES;
          continue;
        }
      }
      fputs("Usage: selection-probe [--target-container] [--delay-ms 10..1000] [--self-test-gesture-distance] [--help]\n", stderr);
      return 2;
    }
    if (showHelp) {
      puts("Usage: selection-probe [--target-container] [--delay-ms 10..1000] [--self-test-gesture-distance] [--help]\n"
           "Default delay: 75ms; listen-only mouse gesture tap; fallback poll: 10ms.\n"
           "Drag intent threshold: 4 global macOS points; no Retina scaling.\n"
           "AX message timeout: 200ms; query budget: 800ms.\n"
           "Public AX fallback: hit-test, 8 parents, current window (depth 7, nodes 64, batches 8).\n"
           "--target-container: replace window scan with one verified hit-ancestry container;\n"
           "  extra depth 3, new nodes 32 (global cap 64), attribute-name checks 6, same time budget.\n"
           "Read-only selection diagnostics on stdout; no automatic permission prompt.\n"
           "Use non-sensitive test text only. Stop with Ctrl+C.\n"
           "--self-test-gesture-distance validates maximum excursion and exits.\n"
           "--help does not start observation or query Accessibility.");
      return 0;
    }
    if (runGestureDistanceSelfTest) return RunGestureDistanceSelfTest();
    setvbuf(stdout, NULL, _IONBF, 0);
    signal(SIGINT, HandleSignal);
    signal(SIGTERM, HandleSignal);
    queryQueue = dispatch_queue_create("selection-probe.ax-query", DISPATCH_QUEUE_SERIAL);
    BOOL listenAccess = CGPreflightListenEventAccess();
    CGEventMask mouseMask = CGEventMaskBit(kCGEventLeftMouseDown) |
        CGEventMaskBit(kCGEventLeftMouseDragged) | CGEventMaskBit(kCGEventLeftMouseUp);
    mouseEventTap = CGEventTapCreate(kCGSessionEventTap, kCGTailAppendEventTap,
        kCGEventTapOptionListenOnly, mouseMask, ObserveMouseGesture, &settleDelayMs);
    if (mouseEventTap != NULL) {
      mouseEventTapSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, mouseEventTap, 0);
      if (mouseEventTapSource != NULL) {
        CFRunLoopAddSource(CFRunLoopGetMain(), mouseEventTapSource, kCFRunLoopCommonModes);
        CGEventTapEnable(mouseEventTap, true);
      } else {
        CFRelease(mouseEventTap);
        mouseEventTap = NULL;
      }
    }
    __block uint32_t lastCount = MouseUpCount();
    printf("[selection-probe] started pid=%d poll_ms=%d settle_ms=%d ax_timeout_ms=200 query_budget_ms=800 max_nodes=64 drag_threshold_points=%.1f\n",
        getpid(), kPollIntervalMs, settleDelayMs, kDragSelectionThresholdPoints);
    printf("[selection-probe] mouse_gesture_event_tap=%s listen_access_preflight=%s automatic_prompt=false\n",
        mouseEventTap != NULL ? "available" : "unavailable",
        listenAccess ? "granted" : "not_granted");
    if (targetContainerMode)
      puts("[selection-probe] mode=target_container max_extra_depth=3 max_new_nodes=32; no broad window scan");
    printf("[selection-probe] accessibility=%s; automatic_prompt=false\n",
        AXIsProcessTrusted() ? "trusted" : "permission_required");
    puts("[selection-probe] Use non-sensitive text only. Selected text is printed to stdout (up to ~512 UTF-16 units). Ctrl+C to stop.");

    dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0,
        dispatch_get_main_queue());
    dispatch_source_set_timer(timer, DISPATCH_TIME_NOW,
        kPollIntervalMs * NSEC_PER_MSEC, NSEC_PER_MSEC);
    dispatch_source_set_event_handler(timer, ^{
      @autoreleasepool {
        if (stopRequested) {
          CFRunLoopStop(CFRunLoopGetMain());
          return;
        }
        if (mouseEventTap != NULL) return;
        uint32_t count = MouseUpCount();
        if (count != lastCount) {
          uint32_t delta = count - lastCount;
          lastCount = count;
          CGEventRef cursorEvent = CGEventCreate(NULL); // Snapshot only; never posted.
          CGPoint mouse = cursorEvent ? CGEventGetLocation(cursorEvent) : CGPointZero;
          BOOL mouseAvailable = cursorEvent != NULL && isfinite(mouse.x) && isfinite(mouse.y);
          if (cursorEvent != NULL) CFRelease(cursorEvent);
          uint64_t generation = ++gestureGenerationCounter;
          NSDictionary *gesture = GestureReport(generation, 0, NO, 0.0, NO,
              CGPointZero, NO);
          CaptureMouseUp(count, delta, settleDelayMs, mouse, mouseAvailable, YES, gesture);
        }
      }
    });
    dispatch_resume(timer);
    CFRunLoopRun();
    dispatch_source_cancel(timer);
    if (mouseEventTapSource != NULL) {
      CFRunLoopRemoveSource(CFRunLoopGetMain(), mouseEventTapSource, kCFRunLoopCommonModes);
      CFRelease(mouseEventTapSource);
      mouseEventTapSource = NULL;
    }
    if (mouseEventTap != NULL) {
      CFMachPortInvalidate(mouseEventTap);
      CFRelease(mouseEventTap);
      mouseEventTap = NULL;
    }
    puts("[selection-probe] stopped; no helper processes were launched.");
  }
  return 0;
}
