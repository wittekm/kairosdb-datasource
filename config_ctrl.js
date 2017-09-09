define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var KairosDBConfigCtrl = /** @class */ (function () {
        /** @ngInject */
        function KairosDBConfigCtrl($scope) {
            this.current.jsonData = this.current.jsonData || {};
        }
        KairosDBConfigCtrl.templateUrl = 'partials/config.html';
        return KairosDBConfigCtrl;
    }());
    exports.KairosDBConfigCtrl = KairosDBConfigCtrl;
});
