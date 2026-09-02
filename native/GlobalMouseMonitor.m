#import <ApplicationServices/ApplicationServices.h>
#import <stdint.h>
#import <unistd.h>

int main(void) {
  @autoreleasepool {
    setvbuf(stdout, NULL, _IONBF, 0);

    uint32_t leftMouseDownCount = CGEventSourceCounterForEventType(
        kCGEventSourceStateCombinedSessionState, kCGEventLeftMouseDown);
    uint32_t rightMouseDownCount = CGEventSourceCounterForEventType(
        kCGEventSourceStateCombinedSessionState, kCGEventRightMouseDown);
    uint32_t otherMouseDownCount = CGEventSourceCounterForEventType(
        kCGEventSourceStateCombinedSessionState, kCGEventOtherMouseDown);

    printf("ready\n");

    while (true) {
      uint32_t nextLeftMouseDownCount = CGEventSourceCounterForEventType(
          kCGEventSourceStateCombinedSessionState, kCGEventLeftMouseDown);
      uint32_t nextRightMouseDownCount = CGEventSourceCounterForEventType(
          kCGEventSourceStateCombinedSessionState, kCGEventRightMouseDown);
      uint32_t nextOtherMouseDownCount = CGEventSourceCounterForEventType(
          kCGEventSourceStateCombinedSessionState, kCGEventOtherMouseDown);

      if (nextLeftMouseDownCount != leftMouseDownCount ||
          nextRightMouseDownCount != rightMouseDownCount ||
          nextOtherMouseDownCount != otherMouseDownCount) {
        printf("mouse-down\n");
      }

      leftMouseDownCount = nextLeftMouseDownCount;
      rightMouseDownCount = nextRightMouseDownCount;
      otherMouseDownCount = nextOtherMouseDownCount;
      usleep(10 * 1000);
    }
  }

  return 0;
}
