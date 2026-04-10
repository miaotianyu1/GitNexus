#import <Foundation/Foundation.h>
@import UIKit;

@interface MyClass : NSObject
- (void)doThing;
- (void)setFoo:(id)x bar:(id)y;
@end

@implementation MyClass
- (void)doThing {
  [self helper];
  [self setFoo:nil bar:nil];
}

- (void)helper {}
@end

