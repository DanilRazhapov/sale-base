import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { Link } from "react-router-dom";
import "../css/AppPages.css";

function HomePage() {
    const [session, setSession] = useState<Session | null>(null);
    const [busy, setBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    useEffect(() => {
        supabase.auth.getSession().then(({ data, error }) => {
            if (error) setErrorMessage("Не удалось загрузить профиль.");
            setSession(data.session);
        }).catch(() => setErrorMessage("Не удалось загрузить профиль. Проверьте подключение."));
    }, []);

    async function handleLogOut() {
        setBusy(true); setErrorMessage("");
        try {
            const { error } = await supabase.auth.signOut();
            if (error) setErrorMessage("Не удалось выйти из аккаунта. Попробуйте снова.");
        } catch { setErrorMessage("Не удалось выйти из аккаунта. Проверьте подключение."); }
        finally { setBusy(false); }
    }

    if (!session) return <main className="app-page"><div className="app-loading" role={errorMessage ? "alert" : "status"}>{errorMessage || "Загрузка кабинета…"}</div></main>;
    const fullName = session.user.user_metadata.full_name;
    const name = typeof fullName === "string" && fullName.trim() ? fullName.trim() : "владелец";

    return (
        <main className="app-page"><div className="app-shell">
            <header className="app-topbar">
                <Link className="app-brand" to="/"><span className="app-brand-mark">S</span>SaleBase</Link>
                <nav aria-label="Основная навигация"><Link to="/owner">Мои магазины</Link><button className="app-button" disabled={busy} onClick={handleLogOut}>{busy ? "Выходим…" : "Выйти"}</button></nav>
            </header>
            {errorMessage && <p className="app-message app-message-error" role="alert">{errorMessage}</p>}
            <section className="home-hero">
                <div><span className="app-eyebrow">ВАШ РАБОЧИЙ КАБИНЕТ</span><h1>Здравствуйте, {name}!</h1><p>Управляйте магазинами, следите за остатками и работой кассиров. Всё необходимое — под рукой.</p></div>
                <span className="home-avatar" aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase()}</span>
            </section>
            <div className="home-section-title"><h2>С чего начнём?</h2><span className="app-eyebrow">БЫСТРЫЙ ДОСТУП</span></div>
            <div className="home-actions">
                <Link className="home-action" to="/owner"><span className="app-tile-icon" aria-hidden="true">▦</span><h3>Мои магазины</h3><p>Каталог товаров, остатки, кассиры и смены каждого магазина.</p><span>Перейти к магазинам <b aria-hidden="true">→</b></span></Link>
                <Link className="home-action" to="/store/new"><span className="app-tile-icon app-tile-icon-green" aria-hidden="true">＋</span><h3>Добавить магазин</h3><p>Укажите название и адрес, чтобы начать вести учёт.</p><span>Создать магазин <b aria-hidden="true">→</b></span></Link>
                <Link className="home-action" to="/cashier"><span className="app-tile-icon app-tile-icon-orange" aria-hidden="true">◷</span><h3>Рабочее место кассира</h3><p>Вход по имени и PIN, продажи и управление своей сменой.</p><span>Открыть кассу <b aria-hidden="true">→</b></span></Link>
            </div>
            <section className="home-account" aria-label="Ваш аккаунт"><span className="app-status-dot" aria-hidden="true" /><div><small>Вход выполнен в аккаунт</small><p>{session.user.email}</p></div></section>
        </div></main>
    )
}

export default HomePage;
