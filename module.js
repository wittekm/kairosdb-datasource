define(["require", "exports", "./datasource", "./query_ctrl"], function (require, exports, datasource_1, query_ctrl_1) {
    "use strict";
    exports.__esModule = true;
    exports.Datasource = datasource_1.KairosDBDatasource;
    exports.QueryCtrl = query_ctrl_1.KairosDBQueryCtrl;
    var KairosDBConfigCtrl = /** @class */ (function () {
        function KairosDBConfigCtrl() {
        }
        KairosDBConfigCtrl.templateUrl = "partials/config.html";
        return KairosDBConfigCtrl;
    }());
    exports.ConfigCtrl = KairosDBConfigCtrl;
    var KairosDBQueryOptionsCtrl = /** @class */ (function () {
        function KairosDBQueryOptionsCtrl() {
        }
        KairosDBQueryOptionsCtrl.templateUrl = "partials/query.options.html";
        return KairosDBQueryOptionsCtrl;
    }());
    exports.QueryOptionsCtrl = KairosDBQueryOptionsCtrl;
});
