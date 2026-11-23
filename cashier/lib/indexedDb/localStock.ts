import type { TerminalProduct } from "../cashierCart";
import type { LocalOperation } from "./localTypes";

export function withPendingStock<Product extends TerminalProduct>(
    products: Product[],
    operations: LocalOperation[],
): Product[] {
    const changes = new Map<string, number>();
    for (const { checkout } of operations) {
        const direction = checkout.kind === "receipt" ? 1 : -1;
        for (const item of checkout.items) {
            const change = direction * Math.round(item.quantity * 1000);
            changes.set(item.product_id, (changes.get(item.product_id) ?? 0) + change);
        }
    }
 
    return products.map((product) => {
        const change = changes.get(product.id);
        if (!change) return product;
        const stock = Math.round(Number(product.stock ?? 0) * 1000) + change;
        return { ...product, stock: Math.max(0, stock) / 1000 };
    });
}
