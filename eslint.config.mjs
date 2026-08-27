import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import obsidianPlugin from "eslint-plugin-obsidianmd";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // tests/*.mjs use Node globals (node:fs, process, etc.)
  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
      },
    },
  },

  // Obsidian plugin rules that DON'T need type info — all source files
  {
    plugins: { obsidianmd: obsidianPlugin },
    files: ["src/**/*.ts"],
    rules: {
      "obsidianmd/commands/no-command-in-command-id": "error",
      "obsidianmd/commands/no-command-in-command-name": "error",
      "obsidianmd/commands/no-default-hotkeys": "error",
      "obsidianmd/commands/no-plugin-id-in-command-id": "error",
      "obsidianmd/commands/no-plugin-name-in-command-name": "error",
      "obsidianmd/prefer-create-el": "error",
      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/vault/iterate": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/editor-drop-paste": "error",
      "obsidianmd/hardcoded-config-path": "error",
      "obsidianmd/no-forbidden-elements": "error",
      "obsidianmd/no-global-this": "error",
      "obsidianmd/no-sample-code": "error",
      "obsidianmd/no-tfile-tfolder-cast": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/object-assign": "error",
      "obsidianmd/platform": "error",
      "obsidianmd/prefer-abstract-input-suggest": "error",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/validate-manifest": "error",
      "obsidianmd/validate-license": ["error"],
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          mode: "loose",
          brands: ["AI PM Tool", "OpenAI", "DeepSeek", "SecretStorage", "Obsidian"],
          acronyms: ["SVN", "API", "LLM", "SMTP", "HTTP", "HTTPS", "TLS", "URL", "ID", "AI", "PM", "YAML", "REST", "JSON", "RFC", "GBK", "UTF"],
          ignoreWords: ["data.json"],
          ignoreRegex: ["AI-PM-TOOL"],
        },
      ],
    },
  },

  // Obsidian plugin rules that NEED type info — source .ts only
  {
    plugins: { obsidianmd: obsidianPlugin },
    files: ["src/**/*.ts"],
    rules: {
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/no-view-references-in-plugin": "error",
      "obsidianmd/no-unsupported-api": "error",
      "obsidianmd/prefer-file-manager-trash-file": "warn",
      "obsidianmd/prefer-instanceof": "error",
    },
  },

  {
    ignores: ["dist/", "node_modules/", "esbuild.config.mjs"],
  },

  // TypeScript type-checked config: source .ts files only
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  }
);
