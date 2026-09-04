const FULFILLMENT_PROVIDERS = new Set(['printful', 'printify']);

function toConsumerProduct(row, variants = []) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.final_price),
    category: row.category,
    printMethods: row.print_methods || [],
    availableColors: row.available_colors || [],
    customizationOptions: row.customization_options || {},
    mandatoryBranding: row.requires_signature_branding
      ? {
          text: 'Made By +U, 4 ALL',
          placement: 'left-side-or-sleeve',
          removable: false,
        }
      : null,
    inventoryCount: Number(row.inventory_count || 0),
    variants: variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku || null,
      price: Number(variant.price),
      inventoryCount: Number(variant.inventory_count || 0),
    })),
  };
}

function positiveInteger(value, fieldName = 'quantity') {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return parsed;
}

function validateFulfillmentProvider(value) {
  const provider = String(value || '').toLowerCase();
  if (!FULFILLMENT_PROVIDERS.has(provider)) {
    throw new Error('fulfillmentProvider must be printful or printify.');
  }
  return provider;
}

function fulfillmentMappingError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateFulfillmentMappingPayload(payload = {}) {
  const fulfillmentProductId = String(payload.fulfillmentProductId || '').trim();
  const variants = Array.isArray(payload.variants) ? payload.variants : [];
  if (!fulfillmentProductId || !variants.length) {
    throw fulfillmentMappingError('fulfillmentProductId and at least one variant mapping are required.');
  }

  const seenVariantIds = new Set();
  const normalizedVariants = variants.map((variant) => {
    const variantId = String(variant.variantId || '').trim();
    const fulfillmentVariantId = String(variant.fulfillmentVariantId || '').trim();
    const brandingFileId = String(variant.brandingFileId || '').trim();
    const brandingPlacement = String(variant.brandingPlacement || '').trim();
    if (!variantId || !fulfillmentVariantId || !brandingFileId || !brandingPlacement) {
      throw fulfillmentMappingError(
        'Each variant mapping requires variantId, fulfillmentVariantId, brandingFileId, and brandingPlacement.'
      );
    }
    if (seenVariantIds.has(variantId)) {
      throw fulfillmentMappingError(`Duplicate variant mapping: ${variantId}.`);
    }
    seenVariantIds.add(variantId);
    return { variantId, fulfillmentVariantId, brandingFileId, brandingPlacement };
  });

  return { fulfillmentProductId, variants: normalizedVariants };
}

function calculateCustomizationPrice(product, payload = {}, variant = null) {
  const pricing = product.customization_options || {};
  const logoPlacements = Array.isArray(payload.logoPlacements) ? payload.logoPlacements : [];
  const extraText = String(payload.text || '').trim();
  const printMethod = payload.printMethod;
  const allowedMethods = product.print_methods || [];

  if (printMethod && !allowedMethods.includes(printMethod)) {
    throw new Error('Selected print method is not available for this product.');
  }

  const logoPlacementFee = logoPlacements.length * Number(pricing.logoPlacementFee || 3);
  const textFee = extraText ? Number(pricing.textFee || Math.min(extraText.length * 0.15, 5)) : 0;
  const printMethodFee = Number((pricing.printMethodFees && pricing.printMethodFees[printMethod]) || 0);
  const customizationCost = Number((logoPlacementFee + textFee + printMethodFee).toFixed(2));
  const markupPercent = Number(product.markup_percent || 20);
  const basePrice = variant ? Number(variant.price) : Number(product.final_price);
  const customizationMarkup = Number((customizationCost * (markupPercent / 100)).toFixed(2));
  const finalPrice = Number((basePrice + customizationCost + customizationMarkup).toFixed(2));

  return {
    basePrice,
    customizationCost,
    customizationMarkup,
    finalPrice,
    mandatoryBranding: product.requires_signature_branding
      ? {
          text: 'Made By +U, 4 ALL',
          placement: 'left-side-or-sleeve',
          removable: false,
        }
      : null,
    breakdown: {
      logoPlacementFee,
      textFee,
      printMethodFee,
    },
  };
}

function toFulfillmentCustomization(payload = {}, mandatoryBranding = null) {
  return {
    logoPlacements: Array.isArray(payload.logoPlacements) ? payload.logoPlacements : [],
    colorScheme: payload.colorScheme || null,
    text: String(payload.text || '').trim().slice(0, 120),
    printMethod: payload.printMethod || null,
    mandatoryBranding,
  };
}

module.exports = {
  calculateCustomizationPrice,
  positiveInteger,
  toConsumerProduct,
  toFulfillmentCustomization,
  validateFulfillmentMappingPayload,
  validateFulfillmentProvider,
};
