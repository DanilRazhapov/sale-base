type OwnerNavIconName = "home" | "store" | "products" | "stock" | "store-add" | "cashier-add";

const paths: Record<OwnerNavIconName, string> = {
    home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
    store: "M3 10h18l-2-6H5l-2 6Zm1 0v10h16V10M9 20v-6h6v6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0",
    products: "m12 3 9 5v8l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5M12 13v8M7.5 5.5l9 5",
    stock: "M4 4h16v16H4V4Zm0 6h16M10 4v6M9 15h6",
    "store-add": "M13 20H4V10M3 10h18l-2-6H5l-2 6ZM8 20v-6h5M18 14v8M14 18h8",
    "cashier-add": "M15 21H3v-2a6 6 0 0 1 10-4M18 14v8M14 18h8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
};

export function OwnerNavIcon({ name }: { name: OwnerNavIconName }) {
    return (
        <svg className="owner-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d={paths[name]} />
        </svg>
    );
}
