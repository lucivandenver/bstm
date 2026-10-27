/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
import fs from 'fs/promises';
import path from 'path';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
🚀 XianFire Model, Express Controller & Middleware Generator

Usage:
  xian create:model <ModelName>
  xian create:controller <ControllerName>
  xian create:add-middleware <MiddlewareName>
  xian create:upload-middleware <MiddlewareName>

Or with npm directly:
  npm run create:model User
  npm run create:controller userController
  npm run create:add-middleware auth
  npm run create:upload-middleware upload

Examples:
  xian create:model User
  xian create:controller userController
  xian create:add-middleware auth
  xian create:upload-middleware upload

Note: Controller names are typically camelCase (e.g., userController, productController)
Note: Middleware names are typically camelCase (e.g., auth, admin, guest) and are
      written to middleware/<name>.js. Generating the first auth middleware also
      makes sure models/userModel.js has a "role" ENUM column (MySQL/Sequelize only).
`);
  process.exit(0);
}

const type = args[0]; // 'model' or 'controller'
const name = args[1]; // e.g., 'User' or 'userController'

// Ensure directories exist
const ensureDir = async (dir) => {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
};

// PascalCase for model names
const toPascalCase = (str) => {
  return str
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
};

// camelCase for controller names
const toCamelCase = (str) => {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};

// Generate Model (Sequelize for MySQL, Mongoose for MongoDB, Firestore helpers for Firebase)
const createModel = async (modelName) => {
  const modelDir = path.join(process.cwd(), 'models');
  await ensureDir(modelDir);

  const pascalName = toPascalCase(modelName);
  const modelPath = path.join(modelDir, `${pascalName}.js`);

  let modelContent = `
  /*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
  // Firebase doesn't require predefined models.
  // Use Firestore directly in controllers or create helper functions here.
  // Collection name: "${pascalName.toLowerCase()}"

  import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";


export const ${pascalName} = sequelize.define("${pascalName.toLowerCase()}", {

  FirstName: { type: DataTypes.STRING, allowNull: false },
  LastName: { type: DataTypes.STRING, allowNull: false },
  MiddleName: { type: DataTypes.STRING, allowNull: false },
  Program: { type: DataTypes.STRING, allowNull: false },
  YearLevel: { type: DataTypes.STRING, allowNull: false },
  Section: { type: DataTypes.STRING, allowNull: false },
});
export { sequelize }; 
  `.trim();

  await fs.writeFile(modelPath, modelContent);
  console.log(`✅ Model created: ${modelPath}`);
};

// Generate Express Controller (named exports)
const createController = async (controllerName) => {
  const controllerDir = path.join(process.cwd(), 'controllers');
  await ensureDir(controllerDir);

  const camelName = toCamelCase(controllerName); // e.g., userController
  const pascalModelName = toPascalCase(camelName.replace(/controller$/, '')); // e.g., User
  const controllerPath = path.join(controllerDir, `${camelName}.js`);

  const controllerContent = `
/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
import { ${pascalModelName}, sequelize } from "../models/${pascalModelName}.js";
await sequelize.sync();
const ${camelName} ={
  index: async (req, res) => {
    res.send("Index Page");
  },
};
export { ${camelName} };
`.trim();

  await fs.writeFile(controllerPath, controllerContent);
  console.log(`✅ Express Controller created: ${controllerPath}`);
};

// ─── Middleware (auth / role guards) ────────────────────────────────────────
const USER_ROLE_FIELD = 'role: { type: DataTypes.ENUM("admin", "staff", "visitors"), allowNull: false, defaultValue: "visitors" }';

// Ensure models/userModel.js declares the "role" ENUM column (Sequelize models only).
// Idempotent: an existing "role" field is never duplicated or overwritten.
const ensureUserRole = async () => {
  const userModelPath = path.join(process.cwd(), 'models', 'userModel.js');

  let source;
  try {
    source = await fs.readFile(userModelPath, 'utf-8');
  } catch {
    console.log('⚠️  models/userModel.js not found — skipped the "role" column. Generate the model first: npm run create:model User');
    return;
  }

  if (/^[ \t]*role[ \t]*:/m.test(source)) {
    console.log('ℹ️  models/userModel.js already has a "role" field — left untouched.');
    return;
  }

  const defineIndex = source.indexOf('sequelize.define(');
  if (defineIndex === -1) {
    console.log('ℹ️  models/userModel.js is not a Sequelize model — add the "role" column manually.');
    return;
  }

  // Walk from the attributes object's opening brace to its matching close brace.
  const openIndex = source.indexOf('{', defineIndex);
  if (openIndex === -1) {
    console.log('⚠️  Could not parse models/userModel.js — add the "role" column manually.');
    return;
  }

  let closeIndex = -1;
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        closeIndex = i;
        break;
      }
    }
  }

  if (closeIndex === -1) {
    console.log('⚠️  Could not parse models/userModel.js — add the "role" column manually.');
    return;
  }

  const before = source.slice(0, closeIndex).replace(/\s+$/, '');
  const after = source.slice(closeIndex);
  const separator = before.endsWith(',') ? '' : ',';

  let updated = before + separator + '\n  ' + USER_ROLE_FIELD + '\n' + after;

  // ENUM needs DataTypes in scope.
  if (!/import[^\n]*\bDataTypes\b[^\n]*sequelize/.test(updated)) {
    updated = 'import { DataTypes } from "sequelize";\n' + updated;
  }

  await fs.writeFile(userModelPath, updated);
  console.log('✅ Added "role" ENUM (admin / staff / visitors) to models/userModel.js');
};

const createMiddleware = async (middlewareName) => {
  const middlewareDir = path.join(process.cwd(), 'middleware');
  await ensureDir(middlewareDir);

  const camelName = toCamelCase(middlewareName); // e.g., auth
  // "auth" -> requireAuth, "admin" -> requireAdmin,
  // and an already-prefixed "requireAdmin" -> requireAdmin (never requireRequireAdmin)
  const guardBase = toPascalCase(middlewareName.replace(/^require/i, '')) || toPascalCase(middlewareName);
  const guardName = 'require' + guardBase;
  const middlewarePath = path.join(middlewareDir, `${camelName}.js`);

  const authMiddleware = `
/*
    MIT License

    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */

import { User } from "../models/userModel.js";

export const ${guardName} = async (req, res, next) => {
  if (!req.session.userId) return res.redirect("/login");

  try {
    const user = await User.findByPk(req.session.userId);
    if (!user) {
      req.session.userId = null;
      return res.redirect("/login");
    }

    req.user = user;
    res.locals.currentUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (role) => [
  ${guardName},
  (req, res, next) => {
    const allowed = Array.isArray(role) ? role : [role];

    if (!req.user || !allowed.includes(req.user.role)) {
      req.session.success = "You do not have permission to perform this action.";
      return res.redirect("/login");
    }

    next();
  },
];

// Usage in routes/index.js:
//   import { ${guardName}, requireRole } from "../middleware/${camelName}.js";
//
//   router.get("/dashboard", ${guardName}, dashboardPage);
//   router.get("/admin", requireRole("admin"), adminPage);
//   router.get("/staff", requireRole(["admin", "staff"]), staffPage);
`.trim();

  await fs.writeFile(middlewarePath, authMiddleware);
  console.log(`✅ Middleware created: ${middlewarePath}`);

  await ensureUserRole();
};

const createUploadMiddleware = async (middlewareName) => {
  const middlewareDir = path.join(process.cwd(), 'middleware');
  await ensureDir(middlewareDir);

  const camelName = toCamelCase(middlewareName);
  const middlewarePath = path.join(middlewareDir, `${camelName}.js`);
  const uploadMiddleware = `
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";

const uploadDir = path.resolve("public/uploads");

fs.mkdirSync(uploadDir, { recursive: true });

const allowedTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const extension = allowedTypes[file.mimetype];

    cb(null, crypto.randomUUID() + extension);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 2048 * 2048,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (!allowedTypes[file.mimetype]) {
      return cb(new Error("Unsupported image format."));
    }

    cb(null, true);
  },
});
`.trim();

  await fs.writeFile(middlewarePath, uploadMiddleware);
  console.log(`✅ Upload middleware created: ${middlewarePath}`);
};

// Run based on type
(async () => {
  try {
    if (type === 'model') {
      await createModel(name);
    } else if (type === 'controller') {
      await createController(name);
    } else if (type === 'middleware') {
      await createMiddleware(name);
    } else if (type === 'upload-middleware') {
      await createUploadMiddleware(name);
    } else {
      console.error('❌ Unknown type. Use "model", "controller", "middleware", or "upload-middleware".');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();