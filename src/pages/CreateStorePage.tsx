import { useRef, useState, type FormEvent } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "../css/AppPages.css";
import "../css/CreateStorePage.css";

const CreateStorePage = () => {
    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const submitting = useRef(false);
    const navigate = useNavigate();

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting.current) return;

        setErrorMessage("");
        const trimmedName = name.trim();
        const trimmedAddress = address.trim();
        if (!trimmedName || trimmedName.length > 120) {
            setErrorMessage("Введите имя магазина длиной от 1 до 120 символов.");
            return;
        }
        if (!trimmedAddress || trimmedAddress.length > 500) {
            setErrorMessage("Введите адрес длиной от 1 до 500 символов.");
            return;
        }

        submitting.current = true;
        setIsSubmitting(true);
        try {
            const { data, error } = await supabase.functions.invoke("create-store", {
                body: { name: trimmedName, address: trimmedAddress },
            });

            if (error) {
                if (error instanceof FunctionsHttpError) {
                    const status = error.context.status;
                    const response = await error.context.json().catch(() => null);
                    if (status === 401) {
                        setErrorMessage("Сессия истекла. Войдите в аккаунт снова.");
                    } else if (status === 403) {
                        setErrorMessage("Для создания магазина нужен активный профиль.");
                    } else if (status === 400) {
                        setErrorMessage("Проверьте имя и адрес магазина.");
                    } else {
                        setErrorMessage(
                            typeof response?.error === "string"
                                ? response.error
                                : "Не удалось создать магазин. Попробуйте позже.",
                        );
                    }
                } else {
                    setErrorMessage("Не удалось связаться с сервисом создания магазина. Проверьте подключение.");
                }
                return;
            }

            if (typeof data?.store?.id !== "string" || !data.store.id) {
                setErrorMessage("Сервис не вернул ID магазина. Проверьте список магазинов перед повторной отправкой.");
                return;
            }

            navigate(`/store/${encodeURIComponent(data.store.id)}`, { replace: true });
        } catch {
            setErrorMessage("Не удалось создать магазин. Проверьте подключение и попробуйте позже.");
        } finally {
            submitting.current = false;
            setIsSubmitting(false);
        }
    }

    return (
        <main className="app-page create-store-page"><div className="app-shell">
            <header className="app-topbar">
                <Link className="app-brand" to="/"><span className="app-brand-mark">S</span>SaleBase</Link>
                <nav aria-label="Основная навигация"><Link to="/">Главная</Link><Link to="/owner">Магазины</Link><Link to="/store/new" aria-current="page">Новый магазин</Link></nav>
            </header>
            <div className="app-page-heading"><div><span className="app-eyebrow">КАБИНЕТ ВЛАДЕЛЬЦА</span><h1>Новый магазин</h1><p>Начните с названия и адреса. Товары, категории и кассиров можно добавить следующим шагом.</p></div></div>
            <div className="create-store-layout">
                <section className="create-store-form-card" aria-labelledby="store-details-title">
                    <div className="create-store-card-heading"><span className="app-tile-icon" aria-hidden="true">▦</span><div><h2 id="store-details-title">Информация о магазине</h2><p>Укажите данные вашей торговой точки.</p></div></div>
                    <form className="app-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
                        <fieldset disabled={isSubmitting}>
                            <label htmlFor="store-name">Название магазина<input id="store-name" name="name" placeholder="Например, Магазин у дома" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required aria-describedby="store-name-hint" /><span id="store-name-hint" className="create-store-hint">Будет отображаться в кабинете и на рабочем месте кассира.</span></label>
                            <label htmlFor="store-address">Адрес<textarea id="store-address" name="address" autoComplete="street-address" placeholder="Город, улица, дом" rows={3} value={address} onChange={(event) => setAddress(event.target.value)} maxLength={500} required /></label>
                            {errorMessage && <p className="app-message app-message-error" role="alert">{errorMessage}</p>}
                            <div className="create-store-actions"><button className="app-button" type="button" onClick={() => navigate("/owner")}>Отмена</button><button className="app-button app-button-primary" type="submit">{isSubmitting ? "Создаём магазин…" : "Создать магазин"}<span aria-hidden="true">→</span></button></div>
                        </fieldset>
                    </form>
                </section>
                <aside className="create-store-sidebar">
                    <span className="app-eyebrow">ПРЕДПРОСМОТР</span><p className="create-store-preview-hint">Так магазин будет выглядеть в вашем списке.</p>
                    <article className="owner-store-card create-store-preview"><div className="owner-store-card-top"><span className="app-tile-icon" aria-hidden="true">▦</span><span className="create-store-draft-badge">Новый магазин</span></div><h3>{name.trim() || "Название магазина"}</h3><p>{address.trim() || "Здесь появится адрес"}</p><span className="owner-store-card-footer">Товары, остатки и касса <b aria-hidden="true">→</b></span></article>
                    <div className="create-store-next"><h2>Что дальше?</h2><ol><li><strong>Добавьте категории</strong><span>Разделите товары на удобные группы.</span></li><li><strong>Заполните каталог</strong><span>Укажите цены и начальные остатки.</span></li><li><strong>Создайте кассиров</strong><span>Добавьте сотрудников для работы на кассе.</span></li></ol></div>
                </aside>
            </div>
        </div></main>
    );
};

export default CreateStorePage;
