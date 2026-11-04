import { Link, useOutletContext } from "react-router-dom";
import type { OwnerLayoutContext } from "../../layouts/OwnerLayout";

function HomePage() {
    const { stores, isLoadingStores, storesError, selectedStoreId } = useOutletContext<OwnerLayoutContext>();
    const selectedStore = stores.find((store) => store.id === selectedStoreId);

    return (
        <main className="owner-page">
            <header className="home-heading">
                <div>
                    <span className="owner-kicker">Рабочее пространство</span>
                    <h1>Магазины</h1>
                    <p>Управляйте ассортиментом, запасами и кассирами ваших торговых точек.</p>
                </div>
                <Link className="button-link-primary" to="/store/new">
                    <span aria-hidden="true">＋</span> Новый магазин
                </Link>
            </header>
            <div className="home-workspace">
                <section className="home-panel home-registry" aria-labelledby="home-stores-heading">
                    <header className="home-panel-header">
                        <h2 id="home-stores-heading">Торговые точки</h2>
                        {!isLoadingStores && !storesError && <span className="store-count">{stores.length}</span>}
                    </header>
                    {isLoadingStores && (
                        <p className="stores-empty" role="status">
                            Загружаем магазины…
                        </p>
                    )}
                    {storesError && (
                        <p className="alert-error" role="alert">
                            {storesError}
                        </p>
                    )}
                    {!isLoadingStores && !storesError && stores.length === 0 && (
                        <div className="stores-empty">
                            <h3>Магазинов пока нет</h3>
                            <p>Добавьте торговую точку, чтобы создать каталог и подключить кассиров.</p>
                        </div>
                    )}
                    {stores.length > 0 && (
                        <>
                            <div className="home-store-columns" aria-hidden="true">
                                <span>Название</span>
                                <span>Адрес</span>
                                <span>Переход</span>
                            </div>
                            <ul className="home-store-list">
                                {stores.map((store) => (
                                    <li key={store.id}>
                                        <Link className="home-store-row" to={`/store/${store.id}`}>
                                            <strong>{store.name}</strong>
                                            <span className="home-store-address">
                                                {store.address || "Адрес не указан"}
                                            </span>
                                            <span className="home-store-arrow" aria-hidden="true">
                                                Открыть →
                                            </span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </section>
                <section className="home-panel home-current" aria-labelledby="home-current-heading">
                    <header className="home-panel-header">
                        <h2 id="home-current-heading">Выбранный магазин</h2>
                    </header>
                    <div className="home-current-body">
                        {selectedStore ? (
                            <>
                                <strong>{selectedStore.name}</strong>
                                {selectedStore.address && <p>{selectedStore.address}</p>}
                                <div className="home-current-links">
                                    <Link to={`/store/${selectedStore.id}/inventory`}>Товары</Link>
                                    <Link to={`/store/${selectedStore.id}/stock`}>Остатки</Link>
                                </div>
                            </>
                        ) : (
                            <p>Откройте торговую точку из списка или выберите её в верхнем меню.</p>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}

export default HomePage;
