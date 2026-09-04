'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  printMethods: string[];
  availableColors: Array<{ name?: string; hex?: string }>;
  mandatoryBranding: {
    text: string;
    placement: string;
    removable: false;
  } | null;
  variants: Array<{
    id: string;
    title: string;
    price: number;
    inventoryCount: number;
  }>;
};

type ProductCustomizerProps = {
  product: Product;
};

const placementOptions = ['front', 'back', 'left sleeve', 'right sleeve', 'chest'];

export function ProductCustomizer({ product }: ProductCustomizerProps) {
  const [logoPlacements, setLogoPlacements] = useState<string[]>(['front']);
  const [colorScheme, setColorScheme] = useState(product.availableColors?.[0]?.name || 'Classic');
  const [message, setMessage] = useState('');
  const [printMethod, setPrintMethod] = useState(product.printMethods?.[0] || '');
  const [variantId, setVariantId] = useState(product.variants?.[0]?.id || '');
  const [quotedPrice, setQuotedPrice] = useState<number>(product.variants?.[0]?.price || product.price);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ pricing: { finalPrice: number } }>(`/products/${product.id}/customize`, {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({
        variantId: variantId || undefined,
        logoPlacements,
        colorScheme,
        text: message,
        printMethod: printMethod || undefined,
      }),
    })
      .then((response) => {
        setQuotedPrice(response.pricing.finalPrice);
        setQuoteError(null);
      })
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') {
          setQuoteError(error instanceof Error ? error.message : 'Unable to calculate price.');
        }
      });
    return () => controller.abort();
  }, [colorScheme, logoPlacements, message, printMethod, product.id, variantId]);

  function togglePlacement(value: string) {
    setLogoPlacements((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr]">
      <div className="space-y-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-card">
        <div>
          <h2 className="text-3xl font-semibold text-white">Customize {product.name}</h2>
          <p className="mt-2 text-slate-300">{product.description}</p>
        </div>

        <section>
          {product.variants.length > 0 && (
            <>
              <h3 className="text-lg font-medium text-brand-200">Product variant</h3>
              <select
                value={variantId}
                onChange={(event) => setVariantId(event.target.value)}
                className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-100 px-4 py-3 text-sm text-slate-950"
              >
                {product.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.title} - ${variant.price.toFixed(2)}
                  </option>
                ))}
              </select>
            </>
          )}
        </section>

        <section>
          <h3 className="text-lg font-medium text-brand-200">Logo placement</h3>
          <div className="mt-3 flex flex-wrap gap-3">
            {placementOptions.map((option) => {
              const active = logoPlacements.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => togglePlacement(option)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    active ? 'bg-brand-400 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="text-lg font-medium text-brand-200">Color scheme</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(product.availableColors || []).map((color, index) => {
              const name = color.name || `Option ${index + 1}`;
              const active = colorScheme === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setColorScheme(name)}
                  className={`rounded-2xl border px-4 py-3 text-left ${
                    active ? 'border-brand-400 bg-brand-400/10' : 'border-slate-700 bg-slate-800/70'
                  }`}
                >
                  <span className="block font-medium text-white">{name}</span>
                  <span className="text-sm text-slate-400">{color.hex || 'Custom palette'}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="text-lg font-medium text-brand-200">Message / text</h3>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            placeholder="Add campaign text, taglines, or initials"
            className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-100 px-4 py-3 text-sm text-slate-950 outline-none ring-brand-300 focus:ring-2"
          />
        </section>

        <section>
          <h3 className="text-lg font-medium text-brand-200">Print method</h3>
          <select
            value={printMethod}
            onChange={(event) => setPrintMethod(event.target.value)}
            className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-100 px-4 py-3 text-sm text-slate-950 outline-none ring-brand-300 focus:ring-2"
          >
            {product.printMethods.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </section>
      </div>

      <div className="rounded-3xl border border-brand-400/20 bg-slate-900 p-6 shadow-card">
        <p className="text-sm uppercase tracking-[0.25em] text-brand-300">Server price quote</p>
        <div className="mt-6 space-y-4 text-sm text-slate-200">
          <div className="border-t border-slate-800 pt-4 text-lg font-semibold text-white">
            <div className="flex justify-between"><span>Total preview</span><span>${quotedPrice.toFixed(2)}</span></div>
          </div>
        </div>
        {quoteError && <p className="mt-4 text-sm text-red-200">{quoteError}</p>}
        {product.mandatoryBranding && (
          <div className="mt-6 rounded-2xl border border-brand-400/30 bg-brand-400/10 p-4 text-sm text-brand-100">
            <p className="font-semibold">Required signature branding</p>
            <p className="mt-1">{product.mandatoryBranding.text}</p>
            <p className="mt-1">Placement: left side or sleeve. This element cannot be removed.</p>
          </div>
        )}
        <div className="mt-8 rounded-2xl bg-slate-800/70 p-4 text-sm text-slate-300">
          <p>Selected color: <span className="font-medium text-white">{colorScheme}</span></p>
          <p className="mt-2">Placements: <span className="font-medium text-white">{logoPlacements.join(', ')}</span></p>
          <p className="mt-2">Method: <span className="font-medium text-white">{printMethod}</span></p>
        </div>
      </div>
    </div>
  );
}
