import { useOutletContext } from "react-router-dom";
import { ProductStockSection } from "../../components/store/ProductStockSection";
import { StoreHeader } from "../../components/store/StoreHeader";
import type { StoreLayoutContext } from "../../layouts/StoreLayout";

export default function StoreStockPage() {
    const { store, products, categories } = useOutletContext<StoreLayoutContext>();

    return (
        <main className="management-page !max-w-[1600px]">
            <StoreHeader
                backTo={`/store/${store.id}`}
                backLabel="Вернуться в магазин"
                title={store.name}
            />
            <ProductStockSection products={products} categories={categories} storeId={store.id} />
        </main>
    );
}
