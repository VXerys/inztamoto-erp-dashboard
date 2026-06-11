const fs = require("fs");

const filePath = "public/legacy/app-runtime.js";
let code = fs.readFileSync(filePath, "utf8");

// Patch Firebase config
code = code.replace(
  /const firebaseConfig = \{[\s\S]*?\};/,
  `const firebaseConfig = window.__INZTAMOTO_ENV__?.firebase || {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};`
);

// Patch Cloudinary cloud name
code = code.replace(
  /const CLOUDINARY_CLOUD_NAME = ["'\`][\s\S]*?["'\`];/,
  `const CLOUDINARY_CLOUD_NAME = window.__INZTAMOTO_ENV__?.cloudinary?.cloudName || "";`
);

// Patch Cloudinary upload preset
code = code.replace(
  /const CLOUDINARY_UPLOAD_PRESET = ["'\`][\s\S]*?["'\`];/,
  `const CLOUDINARY_UPLOAD_PRESET = window.__INZTAMOTO_ENV__?.cloudinary?.uploadPreset || "";`
);

fs.writeFileSync(filePath, code);
console.log("✅ app-runtime.js patched successfully");
