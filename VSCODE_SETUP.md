# VS Code Setup Guide

This guide will help you set up the project in Visual Studio Code without any errors.

## Step 1: Install the Project

```bash
# Clone or create the project directory
mkdir signalk-autopilot-furuno
cd signalk-autopilot-furuno

# Create all the files (copy from artifacts)
# - index.js
# - package.json
# - jsconfig.json
# - .gitignore
# - README.md

# Install dependencies (mainly for VS Code IntelliSense)
npm install
```

## Step 2: VS Code Configuration

The project includes a `.vscode/settings.json` file. Create the `.vscode` folder if it doesn't exist:

```bash
mkdir .vscode
```

Then copy the `settings.json` file into `.vscode/settings.json`

## Step 3: Fix Common VS Code Errors

### Error: "Cannot find module" or missing type definitions

**Solution**: The `package.json` now includes `@types/node` which provides Node.js type definitions. Run:

```bash
npm install
```

### Error: "tsconfig.json" errors

**Solution**: The tsconfig.json is now configured for JavaScript projects with these settings:
- `allowJs: true` - Allows JavaScript files
- `checkJs: false` - Doesn't check JavaScript for type errors
- `strict: false` - Relaxed type checking

If you still see errors, you can either:
1. Keep the file (it helps with IntelliSense)
2. Or delete it completely - the project works fine without it

### Error: Red squiggly lines in index.js

**Solution**: If VS Code shows errors about `app.registerAutopilotProvider` or other Signal K functions:

1. These are expected because Signal K types aren't installed
2. The code will still work fine when running in Signal K
3. You can safely ignore these warnings
4. Or add this to the top of index.js:

```javascript
// @ts-nocheck
```

## Step 4: Verify Setup

Open `index.js` in VS Code. You should see:
- ✅ Syntax highlighting works
- ✅ Basic IntelliSense works (for JavaScript built-ins)
- ✅ No errors in the PROBLEMS tab (or only Signal K-specific warnings you can ignore)

## Step 5: Optional - Disable JavaScript Validation

If you prefer to not see any warnings at all:

1. Open VS Code Settings (Ctrl+, or Cmd+,)
2. Search for "javascript validate"
3. Uncheck "JavaScript › Validate: Enable"

Or add this to `.vscode/settings.json`:

```json
{
  "javascript.validate.enable": false
}
```

## Recommended VS Code Extensions

While not required, these extensions can help:

1. **ESLint** - For code quality (optional)
2. **GitLens** - For Git integration (optional)
3. **npm Intellisense** - For npm package completion (optional)

## Project Structure

```
signalk-autopilot-furuno/
├── .vscode/
│   └── settings.json       # VS Code configuration
├── index.js                # Main plugin file (pure JavaScript)
├── package.json           # Package configuration
├── jsconfig.json          # JavaScript project config
├── tsconfig.json          # Optional: TypeScript config for JS
├── .gitignore            # Git ignore rules
├── README.md             # Main documentation
├── VSCODE_SETUP.md       # This file
└── CONTRIBUTING.md       # Contribution guidelines
```

## Troubleshooting

### "Module not found" for @signalk/server-api

This is expected! The Signal K types are only available when the plugin runs inside Signal K Server. You can:

1. Ignore the warning (code will work fine)
2. Or install Signal K Server types (optional):

```bash
npm install --save-dev @signalk/server-api
```

### Can't run the plugin

Remember: This plugin needs to run inside Signal K Server, not standalone. To test:

```bash
# Link to Signal K
cd ~/.signalk
npm link /path/to/signalk-autopilot-furuno

# Restart Signal K
sudo systemctl restart signalk
```

### Still seeing errors?

1. Try closing and reopening VS Code
2. Run `npm install` again
3. Delete `node_modules` and `package-lock.json`, then run `npm install`
4. Check that you're using Node.js 18 or later: `node --version`

## Questions?

If you have issues, please:
1. Check the main [README.md](README.md)
2. Open an issue on GitHub
3. Ask in the Signal K community forums

Happy coding! 🚀