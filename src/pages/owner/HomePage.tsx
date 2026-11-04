import { ui } from "../../lib/ui";
import { useAuth } from "../../auth/session";

function HomePage() {
    const { owner } = useAuth();
    const fullName = owner?.user.user_metadata.full_name;
    const name = typeof fullName === "string" && fullName.trim() ? fullName.trim() : "владелец";

    return (
        <main className={ui.page}>
            <div className="mx-auto max-w-7xl px-8 pb-12 max-lg:px-6 max-md:px-4 max-md:pb-8">
                <section className="home-welcome">
                    <div>
                        <span className={ui.eyebrow}>ВАШ РАБОЧИЙ КАБИНЕТ</span>
                        <h1 className={ui.title}>Здравствуйте, {name}!</h1>
                        <p>
                            Управляйте магазинами, следите за остатками и работой кассиров. Всё необходимое — под рукой.
                        </p>
                    </div>
                    <span
                        className="home-avatar"
                        aria-hidden="true"
                    >
                        {name.slice(0, 1).toLocaleUpperCase()}
                    </span>
                </section>
                <p className={`mt-6 ${ui.muted}`}>Выберите магазин в шапке, чтобы открыть его каталог, остатки и смены.</p>
                <section
                    className="home-status"
                    aria-label="Ваш аккаунт"
                >
                    <span className="home-status-dot" aria-hidden="true" />
                    <div>
                        <small>Вход выполнен в аккаунт</small>
                        <p>{owner?.user.email}</p>
                    </div>
                </section>
            </div>
        </main>
    );
}

export default HomePage;
