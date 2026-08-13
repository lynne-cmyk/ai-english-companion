#import <AppKit/AppKit.h>

int main(void) {
  @autoreleasepool {
    NSRunningApplication *frontmostApplication =
        NSWorkspace.sharedWorkspace.frontmostApplication;
    NSString *applicationName = frontmostApplication.localizedName
        ?: frontmostApplication.bundleIdentifier
        ?: @"Unknown";

    printf("%s\n", applicationName.UTF8String);
  }

  return 0;
}
