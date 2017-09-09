'use strict';
module.exports = function(grunt) {
grunt.loadNpmTasks('grunt-typescript');

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
