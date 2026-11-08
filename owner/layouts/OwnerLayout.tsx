import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useMatch } from "react-router-dom";
import { useOwnerSession } from "../auth/session";
import { supabase } from "../lib/supabase";
import { isStoreId } from "../lib/storeData";

type OwnedStore = { id: string; name: string; address: string | null };

type OwnerStoreList = {
    stores: OwnedStore[];
    isLoadingStores: boolean;
    storesError: string;
};

export type OwnerLayoutContext = OwnerStoreList & { selectedStoreId: string | undefined };

export function OwnerLayout() {
    const { pathname } = useLocation();
    const content = useRef<HTMLDivElement>(null);
    const { owner } = useOwnerSession();
    const storeRoute = useMatch("/store/:storeId/*");
    const routeStoreId = storeRoute?.params.storeId;
    const storeId = isStoreId(routeStoreId) ? routeStoreId : null;
    const [lastStoreId, setLastStoreId] = useState(storeId);
    if (storeId && storeId !== lastStoreId) setLastStoreId(storeId);

    const [storeList, setStoreList] = useState<OwnerStoreList>({
        stores: [],
        isLoadingStores: true,
        storesError: "",
    });
    const selectedStore = storeList.stores.find((store) => store.id === (storeId ?? lastStoreId));
    const activeStoreId = storeId ?? selectedStore?.id;
    const storePath = activeStoreId ? `/store/${activeStoreId}` : null;
    const currentSection = storeRoute?.params["*"]?.replace(/\/$/, "");
    const storeSection = currentSection === "inventory" || currentSection === "stock" ? `/${currentSection}` : "";
    const storeMenu = useRef<HTMLDetailsElement>(null);
    const accountMenu = useRef<HTMLDetailsElement>(null);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [signOutError, setSignOutError] = useState("");
    const user = owner?.user;
    const userId = user?.id;
    const fullName = user?.user_metadata.full_name;
    const accountName =
        typeof fullName === "string" && fullName.trim() ? fullName.trim() : user?.email || "Аккаунт";

    useLayoutEffect(() => {
        content.current?.scrollTo(0, 0);
    }, [pathname]);

    useEffect(() => {
        if (!userId) return;
        let active = true;

        async function loadStores() {
            try {
                const { data, error } = await supabase
                    .from("store_members")
                    .select("stores!inner(id, name, address, is_active)")
                    .eq("user_id", userId)
                    .eq("role", "owner")
                    .eq("is_active", true)
                    .eq("stores.is_active", true);
                if (error) throw error;

                const stores = (data ?? [])
                    .map((row) => row.stores as unknown as OwnedStore)
                    .sort((a, b) => a.name.localeCompare(b.name));
                if (active) setStoreList({ stores, isLoadingStores: false, storesError: "" });
            } catch {
                if (active) {
                    setStoreList((list) => ({
                        ...list,
                        isLoadingStores: false,
                        storesError: "Не удалось загрузить магазины. Проверьте подключение.",
                    }));
                }
            }
        }

        void loadStores();
        return () => { active = false; };
    }, [userId, storeId]);

    useEffect(() => {
        function closeOnOutsideClick(event: PointerEvent) {
            for (const menu of [accountMenu.current, storeMenu.current]) {
                if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
                    menu.open = false;
                }
            }
        }

        document.addEventListener("pointerdown", closeOnOutsideClick);
        return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
    }, []);

    async function signOut() {
        setIsSigningOut(true);
        setSignOutError("");
        try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
        } catch {
            setSignOutError("Не удалось выйти из аккаунта. Попробуйте снова.");
        } finally {
            setIsSigningOut(false);
        }
    }

    return (
        <div className="owner-layout">
            <header className="owner-header">
                <details
                    className="owner-store-picker"
                    ref={storeMenu}
                    onBlur={(event) => {
                        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
                            event.currentTarget.open = false;
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Escape" && event.currentTarget.open) {
                            event.currentTarget.open = false;
                            event.currentTarget.querySelector("summary")?.focus();
                        }
                    }}
                >
                    <summary>
                        <span className="truncate">{selectedStore?.name ?? "Выбрать магазин"}</span>
                        <span className="owner-store-chevron" aria-hidden="true">▾</span>
                    </summary>
                    <div className="owner-store-menu" aria-label="Выбор магазина">
                        {storeList.isLoadingStores && <p role="status">Загружаем магазины…</p>}
                        {storeList.storesError && <p role="alert">{storeList.storesError}</p>}
                        {!storeList.isLoadingStores && !storeList.storesError && !storeList.stores.length && (
                            <p>У вас пока нет магазинов.</p>
                        )}
                        {storeList.stores.map((store) => (
                            <Link
                                key={store.id}
                                to={`/store/${store.id}${storeSection}`}
                                aria-current={store.id === selectedStore?.id ? "true" : undefined}
                                onClick={() => {
                                    if (storeMenu.current) {
                                        storeMenu.current.querySelector("summary")?.focus();
                                        storeMenu.current.open = false;
                                    }
                                }}
                            >
                                {store.name}
                            </Link>
                        ))}
                    </div>
                </details>
                <details
                    className="owner-account"
                    ref={accountMenu}
                    onBlur={(event) => {
                        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
                            event.currentTarget.open = false;
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Escape" && event.currentTarget.open) {
                            event.currentTarget.open = false;
                            event.currentTarget.querySelector("summary")?.focus();
                        }
                    }}
                >
                    <summary>
                        <span className="truncate">{accountName}</span>
                        <span aria-hidden="true">▾</span>
                    </summary>
                    <div className="owner-account-menu">
                        {user?.email && user.email !== accountName && <p>{user.email}</p>}
                        <a href="#" aria-disabled="true" onClick={(event) => event.preventDefault()}>
                            Настройки аккаунта
                        </a>
                        <button
                            type="button"
                            aria-disabled={isSigningOut}
                            onClick={() => {
                                if (!isSigningOut) void signOut();
                            }}
                        >
                            {isSigningOut ? "Выходим…" : "Выйти из аккаунта"}
                        </button>
                        {signOutError && <p className="text-danger" role="alert">{signOutError}</p>}
                    </div>
                </details>
            </header>
            <div className="owner-body">
                <aside className="owner-sidebar">
                    <nav aria-label="Навигация кабинета">
                        <NavLink to="/" end>Главная</NavLink>
                        {storePath && (
                            <>
                                <NavLink to={`${storePath}/inventory`} end>Товары</NavLink>
                                <NavLink to={`${storePath}/stock`} end>Остатки</NavLink>
                            </>
                        )}
                        {!storePath && (
                            <>
                                <span aria-disabled="true">Товары</span>
                                <span aria-disabled="true">Остатки</span>
                            </>
                        )}
                        <NavLink to="/store/new" end>Создать магазин</NavLink>
                        <NavLink to="/cashier/new" end>Создать кассира</NavLink>
                    </nav>
                </aside>
                <div className="owner-content" ref={content}>
                    <Outlet context={{ ...storeList, selectedStoreId: selectedStore?.id } satisfies OwnerLayoutContext} />
                    <footer className="owner-footer">Creator Danil Razhapov</footer>
                </div>
            </div>
        </div>
    );
}
