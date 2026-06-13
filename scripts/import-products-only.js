'use strict';

// ============================================================
// INZTAMOTO Products-only Firebase Migration Script
// Usage: node scripts/import-products-only.js
// Reads from .env.migration — default is DRY_RUN=true (safe)
// ============================================================

require('dotenv').config({ path: '.env.migration' });

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');

// ────────────────────────────────────────────────────────────
// 1. ENVIRONMENT LOADING & VALIDATION
// ────────────────────────────────────────────────────────────

const REQUIRED_VARS = [
  'SOURCE_SERVICE_ACCOUNT_PATH',
  'TARGET_SERVICE_ACCOUNT_PATH',
  'SOURCE_PRODUCTS_COLLECTION',
  'TARGET_PRODUCTS_COLLECTION',
  'TARGET_CATEGORIES_COLLECTION',
];

function validateEnv() {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error('ERROR: Missing required environment variables:');
    missing.forEach((v) => console.error(`  - ${v}`));
    console.error('\nMake sure .env.migration exists and contains all required values.');
    process.exit(1);
  }

  const sourcePath = path.resolve(process.env.SOURCE_SERVICE_ACCOUNT_PATH);
  const targetPath = path.resolve(process.env.TARGET_SERVICE_ACCOUNT_PATH);

  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: Source service account file not found: ${sourcePath}`);
    process.exit(1);
  }

  if (!fs.existsSync(targetPath)) {
    console.error(`ERROR: Target service account file not found: ${targetPath}`);
    process.exit(1);
  }

  return { sourcePath, targetPath };
}

const { sourcePath, targetPath } = validateEnv();

const SOURCE_PRODUCTS_COLLECTION = process.env.SOURCE_PRODUCTS_COLLECTION;
const TARGET_PRODUCTS_COLLECTION = process.env.TARGET_PRODUCTS_COLLECTION;
const TARGET_CATEGORIES_COLLECTION = process.env.TARGET_CATEGORIES_COLLECTION;
const DRY_RUN = process.env.DRY_RUN !== 'false'; // default true
const OVERWRITE = process.env.OVERWRITE === 'true'; // default false

// ────────────────────────────────────────────────────────────
// 2. FIREBASE ADMIN SETUP
// ────────────────────────────────────────────────────────────

const sourceServiceAccount = require(sourcePath);
const targetServiceAccount = require(targetPath);

const sourceApp = admin.initializeApp(
  { credential: admin.cert(sourceServiceAccount) },
  'source'
);

const targetApp = admin.initializeApp(
  { credential: admin.cert(targetServiceAccount) },
  'target'
);

const sourceDb = getFirestore(sourceApp);
const targetDb = getFirestore(targetApp);

// ────────────────────────────────────────────────────────────
// 3. CATEGORY RULES
// ────────────────────────────────────────────────────────────

const CATEGORY_RULES = [
  { name: 'Botol Bag',    slug: 'botol-bag',    skuCode: 'BB', patterns: ['botol-bag', 'bottle-bag', 'botol bag', 'bottle bag'] },
  { name: 'Side Bag',     slug: 'side-bag',     skuCode: 'SB', patterns: ['side-bag', 'sidebag', 'side bag', 'side-bage'] },
  { name: 'Tail Bag',     slug: 'tail-bag',     skuCode: 'TB', patterns: ['tail-bag', 'tailbag', 'tail bag'] },
  { name: 'Tank Bag',     slug: 'tank-bag',     skuCode: 'TK', patterns: ['tankbag', 'tank-bag', 'tank bag', 'tankbag-and-tailbag'] },
  { name: 'Crashbar Bag', slug: 'crashbar-bag', skuCode: 'CB', patterns: ['crashbar-bag', 'crashbar bag', 'crashbar'] },
  { name: 'Extend Bag',   slug: 'extend-bag',   skuCode: 'EB', patterns: ['extend-bag', 'extend bag'] },
  { name: 'Medikit',      slug: 'medikit',      skuCode: 'MK', patterns: ['medikit', 'medikit-ride'] },
  { name: 'Pouch',        slug: 'pouch',        skuCode: 'PC', patterns: ['pounch', 'pouch'] },
];

// ────────────────────────────────────────────────────────────
// 4. CATEGORY DETECTION
// ────────────────────────────────────────────────────────────

function detectCategory(sourceDoc, product) {
  const text = [
    sourceDoc.id,
    product.slug,
    product.name,
    product.category,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const rule of CATEGORY_RULES) {
    for (const pattern of rule.patterns) {
      if (text.includes(pattern)) {
        return rule;
      }
    }
  }

  return null; // unmapped
}

// ────────────────────────────────────────────────────────────
// 5. IMAGE NORMALIZATION
// ────────────────────────────────────────────────────────────

function normalizeImages(product) {
  const urls = [];

  if (product.imageUrl && typeof product.imageUrl === 'string' && product.imageUrl.trim()) {
    urls.push(product.imageUrl.trim());
  }

  if (Array.isArray(product.images)) {
    for (const img of product.images) {
      if (img && typeof img === 'string' && img.trim()) {
        urls.push(img.trim());
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const url of urls) {
    if (!seen.has(url)) {
      seen.add(url);
      unique.push(url);
    }
  }

  return unique.map((url) => ({ imageUrl: url }));
}

// ────────────────────────────────────────────────────────────
// 6. SKU GENERATION
// ────────────────────────────────────────────────────────────

function buildSkuSequences(targetProducts) {
  // Returns { [skuCode]: maxSequence }
  const sequences = {};

  for (const CATEGORY_RULES_item of CATEGORY_RULES) {
    sequences[CATEGORY_RULES_item.skuCode] = 0;
  }

  for (const prod of targetProducts) {
    if (!prod.sku) continue;
    // Format: INZ-XX-NN
    const match = prod.sku.match(/^INZ-([A-Z]+)-(\d+)$/);
    if (match) {
      const code = match[1];
      const seq = parseInt(match[2], 10);
      if (sequences[code] !== undefined) {
        if (seq > sequences[code]) {
          sequences[code] = seq;
        }
      }
    }
  }

  return sequences;
}

function makeSKUGenerator(targetProducts) {
  const sequences = buildSkuSequences(targetProducts);
  const usedSkus = new Set(targetProducts.map((p) => p.sku).filter(Boolean));

  return function generateSku(skuCode) {
    let seq = (sequences[skuCode] || 0) + 1;
    let sku = `INZ-${skuCode}-${String(seq).padStart(2, '0')}`;
    while (usedSkus.has(sku)) {
      seq += 1;
      sku = `INZ-${skuCode}-${String(seq).padStart(2, '0')}`;
    }
    sequences[skuCode] = seq;
    usedSkus.add(sku);
    return sku;
  };
}

// ────────────────────────────────────────────────────────────
// 7. PRODUCT MAPPING
// ────────────────────────────────────────────────────────────

function mapProduct(sourceDoc, product, generatedSku, targetCategoryId, now) {
  const normalizedImages = normalizeImages(product);
  const sellingPrice = Number(product.price || 0);

  return {
    name: product.name || sourceDoc.id,
    slug: product.slug || sourceDoc.id,
    sku: generatedSku,
    categoryId: targetCategoryId,
    description: product.description || '',

    costPrice: 0,
    sellingPrice: sellingPrice,
    originalPrice: Number(product.originalPrice || 0),

    profit: sellingPrice,
    margin: sellingPrice > 0 ? 100 : 0,

    stock: Number(product.stock || 0),
    status: product.isActive === false ? 'inactive' : 'active',
    featured: false,

    images: normalizedImages,

    sourceProductId: sourceDoc.id,
    sourceCategory: product.category || '',
    importedAt: now,
    importedFrom: 'old-firebase-products',

    createdAt: product.createdAt || now,
    updatedAt: now,
  };
}

// ────────────────────────────────────────────────────────────
// 8. MAIN MIGRATION FUNCTION
// ────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('Products-only Firebase Migration');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'REAL IMPORT'}`);
  console.log('');

  // ── Read source products ──────────────────────────────────
  const sourceSnap = await sourceDb.collection(SOURCE_PRODUCTS_COLLECTION).get();
  if (sourceSnap.empty) {
    console.error('ERROR: Source products collection is empty. Nothing to migrate.');
    process.exit(1);
  }

  const sourceProducts = sourceSnap.docs.map((doc) => ({
    id: doc.id,
    data: doc.data(),
  }));

  // ── Read target products ──────────────────────────────────
  const targetProductsSnap = await targetDb.collection(TARGET_PRODUCTS_COLLECTION).get();
  const targetProducts = targetProductsSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  // ── Read target categories ────────────────────────────────
  const targetCategoriesSnap = await targetDb.collection(TARGET_CATEGORIES_COLLECTION).get();
  const targetCategories = targetCategoriesSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  // ── Build duplicate indexes ───────────────────────────────
  const existingBySourceProductId = new Map();
  const existingBySlug = new Map();
  const existingByName = new Map();
  const existingBySku = new Map();

  for (const tp of targetProducts) {
    if (tp.sourceProductId) existingBySourceProductId.set(tp.sourceProductId, tp);
    if (tp.slug)            existingBySlug.set(tp.slug, tp);
    if (tp.name)            existingByName.set(tp.name, tp);
    if (tp.sku)             existingBySku.set(tp.sku, tp);
  }

  // ── Detect categories for each source product ────────────
  const now = new Date().toISOString();
  const categoryCountMap = {}; // skuCode -> count
  const unmapped = [];
  const mappedProducts = []; // { sourceDoc, product, categoryRule }

  for (const { id: docId, data: product } of sourceProducts) {
    const rule = detectCategory({ id: docId }, product);
    if (!rule) {
      unmapped.push({ id: docId, name: product.name || '' });
    } else {
      categoryCountMap[rule.skuCode] = (categoryCountMap[rule.skuCode] || 0) + 1;
      mappedProducts.push({ sourceDoc: { id: docId }, product, categoryRule: rule });
    }
  }

  // ── Match or plan target categories ──────────────────────
  const neededRules = CATEGORY_RULES.filter((r) => categoryCountMap[r.skuCode] > 0);

  const categoryPlan = []; // { rule, action: 'reuse'|'create', existingId? }

  for (const rule of neededRules) {
    const existing =
      targetCategories.find((c) => c.slug === rule.slug) ||
      targetCategories.find((c) => c.skuCode === rule.skuCode) ||
      targetCategories.find((c) => c.name === rule.name);

    if (existing) {
      categoryPlan.push({ rule, action: 'reuse', existingId: existing.id });
    } else {
      categoryPlan.push({ rule, action: 'create', existingId: null });
    }
  }

  const willCreateCategories = categoryPlan.filter((c) => c.action === 'create').length;
  const willReuseCategories  = categoryPlan.filter((c) => c.action === 'reuse').length;

  // ── Plan product import ───────────────────────────────────
  const generateSku = makeSKUGenerator(targetProducts);

  // Build a temporary category ID map (for planning; real IDs assigned on create)
  // For planning purposes use rule slug as placeholder
  const plannedCategoryIdMap = {}; // skuCode -> id/placeholder
  for (const cp of categoryPlan) {
    plannedCategoryIdMap[cp.rule.skuCode] =
      cp.action === 'reuse' ? cp.existingId : `[NEW:${cp.rule.slug}]`;
  }

  let willCreate = 0;
  let willSkip = 0;
  let missingPrice = 0;
  let missingImage = 0;
  const sampleProducts = [];

  const productPlan = []; // { sourceDoc, product, categoryRule, sku, isDuplicate, existingDoc }

  for (const { sourceDoc, product, categoryRule } of mappedProducts) {
    const isDuplicate =
      existingBySourceProductId.has(sourceDoc.id) ||
      existingBySlug.has(product.slug || sourceDoc.id) ||
      existingByName.has(product.name || sourceDoc.id);

    let existingDoc = null;
    if (isDuplicate) {
      existingDoc =
        existingBySourceProductId.get(sourceDoc.id) ||
        existingBySlug.get(product.slug || sourceDoc.id) ||
        existingByName.get(product.name || sourceDoc.id) ||
        null;
    }

    const sku = generateSku(categoryRule.skuCode);
    const sellingPrice = Number(product.price || 0);
    const images = normalizeImages(product);

    if (sellingPrice === 0) missingPrice += 1;
    if (images.length === 0) missingImage += 1;

    if (isDuplicate) {
      willSkip += 1;
    } else {
      willCreate += 1;
    }

    if (sampleProducts.length < 5 && !isDuplicate) {
      sampleProducts.push({
        id: sourceDoc.id,
        categoryName: categoryRule.name,
        sku,
        price: sellingPrice,
        stock: Number(product.stock || 0),
      });
    }

    productPlan.push({ sourceDoc, product, categoryRule, sku, isDuplicate, existingDoc });
  }

  // ── Print summary ─────────────────────────────────────────
  console.log(`Source products found: ${sourceProducts.length}`);
  console.log(`Target products existing: ${targetProducts.length}`);
  console.log('');
  console.log('Category mapping:');
  for (const rule of CATEGORY_RULES) {
    const count = categoryCountMap[rule.skuCode] || 0;
    if (count > 0) {
      console.log(`  - ${rule.name} (${rule.skuCode}): ${count}`);
    }
  }
  console.log('');
  console.log(`Will create categories: ${willCreateCategories}`);
  console.log(`Will reuse categories:  ${willReuseCategories}`);
  console.log(`Will create products:   ${willCreate}`);
  console.log(`Will skip duplicates:   ${willSkip}`);
  console.log(`Missing price:          ${missingPrice}`);
  console.log(`Missing image:          ${missingImage}`);
  console.log(`Unmapped products:      ${unmapped.length}`);
  console.log('');

  if (sampleProducts.length > 0) {
    console.log(`Sample (first ${sampleProducts.length}):`);
    for (const s of sampleProducts) {
      console.log(`  - ${s.id} -> ${s.categoryName} -> ${s.sku} -> Rp${s.price} -> stock ${s.stock}`);
    }
    console.log('');
  }

  if (unmapped.length > 0) {
    console.log('Unmapped products:');
    for (const u of unmapped) {
      console.log(`  - ${u.id} | ${u.name}`);
    }
    console.log('');
    console.log('Import blocked until unmapped products are resolved.');
    console.log('');
  }

  // ── Stop here if dry run ──────────────────────────────────
  if (DRY_RUN) {
    console.log('DRY RUN complete. No data was written.');
    console.log('Set DRY_RUN=false in .env.migration to run the real import.');
    process.exit(0);
  }

  // ────────────────────────────────────────────────────────────
  // 11. REAL IMPORT
  // ────────────────────────────────────────────────────────────

  if (unmapped.length > 0) {
    console.error('ERROR: Cannot run real import — unmapped products exist.');
    console.error('Resolve unmapped products first, then re-run.');
    process.exit(1);
  }

  console.log('Starting real import...');
  console.log('');

  // ── Create missing categories ─────────────────────────────
  const categoryIdMap = {}; // skuCode -> Firestore doc ID

  for (const cp of categoryPlan) {
    if (cp.action === 'reuse') {
      categoryIdMap[cp.rule.skuCode] = cp.existingId;
      console.log(`  [CATEGORY] Reuse: ${cp.rule.name} (${cp.rule.slug}) -> ${cp.existingId}`);
    } else {
      const newCategoryRef = targetDb.collection(TARGET_CATEGORIES_COLLECTION).doc();
      const categoryData = {
        name: cp.rule.name,
        slug: cp.rule.slug,
        description: 'Kategori hasil import produk Firebase lama',
        skuCode: cp.rule.skuCode,
        productCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await newCategoryRef.set(categoryData);
      categoryIdMap[cp.rule.skuCode] = newCategoryRef.id;
      console.log(`  [CATEGORY] Created: ${cp.rule.name} -> ${newCategoryRef.id}`);
    }
  }

  console.log('');

  // ── Import products ───────────────────────────────────────
  let created = 0;
  let skipped = 0;
  let updated = 0;
  let errors = 0;

  for (const { sourceDoc, product, categoryRule, sku, isDuplicate, existingDoc } of productPlan) {
    const targetCategoryId = categoryIdMap[categoryRule.skuCode];
    const mappedProduct = mapProduct(sourceDoc, product, sku, targetCategoryId, now);

    try {
      if (isDuplicate) {
        if (OVERWRITE && existingDoc) {
          // Only update if matched by sourceProductId or slug
          const matchedById  = existingBySourceProductId.get(sourceDoc.id);
          const matchedBySlug = existingBySlug.get(product.slug || sourceDoc.id);
          const docToUpdate = matchedById || matchedBySlug;
          if (docToUpdate) {
            await targetDb
              .collection(TARGET_PRODUCTS_COLLECTION)
              .doc(docToUpdate.id)
              .update({ ...mappedProduct, updatedAt: now });
            console.log(`  [UPDATE]  ${sourceDoc.id} -> ${sku}`);
            updated += 1;
          } else {
            console.log(`  [SKIP]    ${sourceDoc.id} (duplicate, no sourceProductId/slug match for overwrite)`);
            skipped += 1;
          }
        } else {
          console.log(`  [SKIP]    ${sourceDoc.id} (duplicate)`);
          skipped += 1;
        }
      } else {
        await targetDb.collection(TARGET_PRODUCTS_COLLECTION).add(mappedProduct);
        console.log(`  [CREATE]  ${sourceDoc.id} -> ${sku} -> ${categoryRule.name}`);
        created += 1;
      }
    } catch (err) {
      console.error(`  [ERROR]   ${sourceDoc.id}: ${err.message}`);
      errors += 1;
    }
  }

  // ── Final summary ─────────────────────────────────────────
  console.log('');
  console.log('Import complete.');
  console.log(`  Created:  ${created}`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);
  console.log('');

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL ERROR:', err.message || err);
  process.exit(1);
});
