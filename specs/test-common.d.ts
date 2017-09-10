
declare module "test/lib/common" {
    export var describe, beforeEach, it, sinon, expect, angularMocks;
}

declare module 'test/specs/helpers' {
    var helpers: any;
    export default helpers;
}
