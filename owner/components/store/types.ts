export type Store = { id: string; name: string; address: string | null };
export type Category = { id: number; name: string };
export type Product = {
    id: string;
    name: string;
    category_id: number | null;
    unit: string | null;
    price: number | null;
    stock: number | null;
    is_active?: boolean;
    updated_at: string | null;
};

export type RunStoreAction = (action: () => Promise<void>, success: string) => Promise<void>;
