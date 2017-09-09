'use strict';
module.exports = function(grunt) {

  grunt.initConfig({
    ts: {
      default: {
        src: ["**/*.ts", "!node_modules/**"],
        tsconfig: true,
        options: {
          verbose: true
        }
      }
    }
  });

  grunt.loadNpmTasks("grunt-ts");
  grunt.registerTask("default", ["ts"]);
}
