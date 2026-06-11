export const SKU_MAP = {
  'Tail Bag': 'INZ-TAIL',
  'Side Bag': 'INZ-SIDE',
  'Duffel Bag': 'INZ-DUFF',
  'Tank Bag': 'INZ-TANK',
  'Tool Bag': 'INZ-TOOL',
  'Dry Bag': 'INZ-DRY',
  'Pannier Bag': 'INZ-PAN',
  'Accessories': 'INZ-ACC',
};

export const CHANNELS = ['Website', 'Shopee', 'Tokopedia', 'WhatsApp', 'Offline Store'];

export const SEED_CATEGORIES = [
  { name: 'Tail Bag', slug: 'tail-bag', description: 'Tas bagasi belakang motor' },
  { name: 'Side Bag', slug: 'side-bag', description: 'Tas samping motor' },
  { name: 'Duffel Bag', slug: 'duffel-bag', description: 'Tas duffel untuk touring' },
];

export const SEED_PRODUCTS = [
  { name: 'Tail Bag Urban X1', categoryName: 'Tail Bag', description: 'Tail bag premium untuk harian', costPrice: 85000, sellingPrice: 165000, stock: 45, status: 'active', featured: true },
  { name: 'Side Bag Navigator', categoryName: 'Side Bag', description: 'Side bag waterproof dengan buckle premium', costPrice: 95000, sellingPrice: 195000, stock: 32, status: 'active', featured: true },
  { name: 'Duffel Bag Expedition 40L', categoryName: 'Duffel Bag', description: 'Duffel bag 40L tahan air', costPrice: 150000, sellingPrice: 295000, stock: 18, status: 'active', featured: true },
];

export const DEMO_USERS = [
  { name: 'Rizky InztaMoto', email: 'admin@inztamoto.com', role: 'Owner', status: 'Aktif' },
  { name: 'Sari Admin', email: 'sari@inztamoto.com', role: 'Admin', status: 'Aktif' },
  { name: 'Budi Warehouse', email: 'budi@inztamoto.com', role: 'Warehouse', status: 'Aktif' },
];
