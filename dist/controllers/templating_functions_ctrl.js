System.register(["lodash"], function (exports_1, context_1) {
    "use strict";
    var lodash_1, TemplatingFunctionsCtrl;
    var __moduleName = context_1 && context_1.id;
    return {
        setters: [
            function (lodash_1_1) {
                lodash_1 = lodash_1_1;
            }
        ],
        execute: function () {
            TemplatingFunctionsCtrl = /** @class */ (function () {
                function TemplatingFunctionsCtrl(templatingFunctionResolver) {
                    this.functions = [];
                    this.templatingFunctionResolver = templatingFunctionResolver;
                }
                TemplatingFunctionsCtrl.prototype.register = function (func) {
                    this.functions.push(func);
                };
                TemplatingFunctionsCtrl.prototype.resolve = function (functionBody) {
                    var matchedFunction = lodash_1.default.find(this.functions, function (func) { return new RegExp(func.regexp).test(functionBody); });
                    return this.templatingFunctionResolver.unpackFunction(matchedFunction, functionBody);
                };
                return TemplatingFunctionsCtrl;
            }());
            exports_1("TemplatingFunctionsCtrl", TemplatingFunctionsCtrl);
        }
    };
});
//# sourceMappingURL=templating_functions_ctrl.js.map