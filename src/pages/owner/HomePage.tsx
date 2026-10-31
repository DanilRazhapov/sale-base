import { ui } from "../../lib/ui";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { Link } from "react-router-dom";

function HomePage() {
    const [session, setSession] = useState<Session | null>(null);
    const [busy, setBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    useEffect(() => {
        supabase.auth
            .getSession()
            .then(({ data, error }) => {
                if (error) setErrorMessage("Не удалось загрузить профиль.");
                setSession(data.session);
            })
            .catch(() => setErrorMessage("Не удалось загрузить профиль. Проверьте подключение."));
    }, []);

    async function handleLogOut() {
        setBusy(true);
        setErrorMessage("");
        try {
            const { error } = await supabase.auth.signOut();
            if (error) setErrorMessage("Не удалось выйти из аккаунта. Попробуйте снова.");
        } catch {
            setErrorMessage("Не удалось выйти из аккаунта. Проверьте подключение.");
        } finally {
            setBusy(false);
        }
    }

    if (!session)
        return (
            <main className={ui.page}>
                <div className="px-6 py-20 text-center text-muted" role={errorMessage ? "alert" : "status"}>
                    {errorMessage || "Загрузка кабинета…"}
                </div>
            </main>
        );
    const fullName = session.user.user_metadata.full_name;
    const name = typeof fullName === "string" && fullName.trim() ? fullName.trim() : "владелец";

    return (
        <main className={ui.page}>
            <div className="mx-auto max-w-7xl px-8 pb-12 max-lg:px-6 max-md:px-4 max-md:pb-8">
                <header className="site-header">
                    <Link className="brand-link" to="/">
                        <span className="brand-mark">S</span>SaleBase
                    </Link>
                    <nav aria-label="Основная навигация">
                        <Link to="/owner">Мои магазины</Link>
                        <button className={ui.buttonBase + " button-secondary"} disabled={busy} onClick={handleLogOut}>
                            {busy ? "Выходим…" : "Выйти"}
                        </button>
                    </nav>
                </header>
                {errorMessage && (
                    <p className="alert-error" role="alert">
                        {errorMessage}
                    </p>
                )}
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
                <div className="mt-8 mb-4 flex items-center justify-between gap-3 [&_h2]:text-xl">
                    <h2 className={ui.heading}>С чего начнём?</h2>
                    <span className={ui.eyebrow}>БЫСТРЫЙ ДОСТУП</span>
                </div>
                <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                    <Link className="navigation-card" to="/owner">
                        <span className="icon-tile" aria-hidden="true">
                            ▦
                        </span>
                        <h3 className={ui.subheading}>Мои магазины</h3>
                        <p>Каталог товаров, остатки, кассиры и смены каждого магазина.</p>
                        <span>
                            Перейти к магазинам <b aria-hidden="true">→</b>
                        </span>
                    </Link>
                    <Link className="navigation-card" to="/store/new">
                        <span className="icon-tile-success" aria-hidden="true">
                            ＋
                        </span>
                        <h3 className={ui.subheading}>Добавить магазин</h3>
                        <p>Укажите название и адрес, чтобы начать вести учёт.</p>
                        <span>
                            Создать магазин <b aria-hidden="true">→</b>
                        </span>
                    </Link>
                </div>
                <section
                    className="home-status"
                    aria-label="Ваш аккаунт"
                >
                    <span className="home-status-dot" aria-hidden="true" />
                    <div>
                        <small>Вход выполнен в аккаунт</small>
                        <p>{session.user.email}</p>
                    </div>
                </section>
            </div>
        </main>
    );
}

export default HomePage;
