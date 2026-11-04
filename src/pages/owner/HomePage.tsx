import { Link, useOutletContext } from "react-router-dom";
import { useAuth } from "../../auth/session";
import type { OwnerLayoutContext } from "../../layouts/OwnerLayout";

function HomePage() {
    const { owner } = useAuth();
    const { stores, isLoadingStores, storesError } = useOutletContext<OwnerLayoutContext>();
    const fullName = owner?.user.user_metadata.full_name;
    const name = typeof fullName === "string" ? fullName.trim() : "";

    return (
        <main className="owner-page owner-home">
            <section className="home-welcome">
                <div className="home-welcome-copy">
                    <span className="owner-kicker">Рабочее пространство</span>
                    <h1>Ваши магазины</h1>
                    <p>
                        {name ? `Здравствуйте, ${name}! ` : ""}
                        Откройте магазин, чтобы посмотреть товары, остатки и смены кассиров.
                    </p>
                    <Link className="button-link-primary" to="/store/new">
                        <span aria-hidden="true">＋</span> Новый магазин
                    </Link>
                </div>
                <div className="home-welcome-art" aria-hidden="true">
                    <svg viewBox="0 0 210 160" fill="none">
                        <path d="M105 12 184 50v61l-79 38-79-38V50l79-38Z" />
                        <path d="m26 50 79 39 79-39M105 89v60M65 31l80 39v60M65 130V70l79-39" />
                        <path d="m26 81 79 39 79-39M105 12v37M65 70l40-21 40 21" />
                        <circle cx="105" cy="89" r="5" />
                        <circle cx="26" cy="50" r="4" />
                        <circle cx="184" cy="111" r="4" />
                    </svg>
                </div>
            </section>
            <div className="home-workspace">
                <section aria-labelledby="home-stores-heading">
                    <div className="home-section-heading">
                        <h2 id="home-stores-heading">Торговые точки</h2>
                        {!isLoadingStores && !storesError && <span className="store-count">{stores.length}</span>}
                    </div>
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
                            <span className="icon-tile" aria-hidden="true">
                                ◫
                            </span>
                            <h3>Здесь появятся ваши магазины</h3>
                            <p>Добавьте первую торговую точку, чтобы настроить каталог и подключить кассиров.</p>
                        </div>
                    )}
                    {stores.length > 0 && (
                        <ul className="home-store-list">
                            {stores.map((store) => (
                                <li key={store.id}>
                                    <Link className="home-store-card" to={`/store/${store.id}`}>
                                        <span className="icon-tile" aria-hidden="true">
                                            ◫
                                        </span>
                                        <div>
                                            <h3>{store.name}</h3>
                                            <p>{store.address || "Адрес не указан"}</p>
                                        </div>
                                        <span className="home-store-arrow" aria-hidden="true">
                                            ↗
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
                <section aria-labelledby="home-actions-heading">
                    <div className="home-section-heading">
                        <h2 id="home-actions-heading">Быстрые действия</h2>
                    </div>
                    <div className="home-actions">
                        <Link to="/store/new">
                            <span>
                                <strong>Создать магазин</strong>
                                <small>Добавьте торговую точку</small>
                            </span>
                            <span aria-hidden="true">↗</span>
                        </Link>
                        <Link to="/cashier/new">
                            <span>
                                <strong>Создать кассира</strong>
                                <small>Настройте доступ к кассе</small>
                            </span>
                            <span aria-hidden="true">↗</span>
                        </Link>
                    </div>
                </section>
            </div>
        </main>
    );
}

export default HomePage;
