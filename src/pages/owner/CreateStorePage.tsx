import { ui } from "../../lib/ui";
import { useRef, useState, type FormEvent } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

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

            navigate(`/store/${encodeURIComponent(data.store.id)}`, {
                replace: true,
            });
        } catch {
            setErrorMessage("Не удалось создать магазин. Проверьте подключение и попробуйте позже.");
        } finally {
            submitting.current = false;
            setIsSubmitting(false);
        }
    }

    return (
        <main className={ui.page}>
            <div className="mx-auto max-w-7xl px-8 pb-12 max-lg:px-6 max-md:px-4 max-md:pb-8">
                <header className="site-header">
                    <Link className="brand-link" to="/">
                        <span className="brand-mark">S</span>SaleBase
                    </Link>
                    <nav aria-label="Основная навигация">
                        <Link to="/">Главная</Link>
                        <Link to="/owner">Магазины</Link>
                        <Link to="/store/new" aria-current="page">
                            Новый магазин
                        </Link>
                    </nav>
                </header>
                <div className="page-intro">
                    <div>
                        <span className={ui.eyebrow}>КАБИНЕТ ВЛАДЕЛЬЦА</span>
                        <h1 className={ui.title}>Новый магазин</h1>
                        <p>Начните с названия и адреса. Товары, категории и кассиров можно добавить следующим шагом.</p>
                    </div>
                </div>
                <div className="grid max-w-5xl grid-cols-[minmax(0,1.45fr)_minmax(280px,1fr)] items-start gap-7 max-lg:gap-5 max-md:grid-cols-1">
                    <section
                        className="store-create-form"
                        aria-labelledby="store-details-title"
                    >
                        <div className="mb-7 flex items-center gap-4 [&_h2]:text-xl [&_h2]:tracking-tight [&_p]:mt-1 [&_p]:text-sm [&_p]:text-muted">
                            <span className="icon-tile" aria-hidden="true">
                                ▦
                            </span>
                            <div>
                                <h2 className={ui.heading} id="store-details-title">
                                    Информация о магазине
                                </h2>
                                <p>Укажите данные вашей торговой точки.</p>
                            </div>
                        </div>
                        <form onSubmit={handleSubmit} aria-busy={isSubmitting}>
                            <fieldset className={ui.fieldset} disabled={isSubmitting}>
                                <label className={ui.label} htmlFor="store-name">
                                    Название магазина
                                    <input
                                        className={ui.input}
                                        id="store-name"
                                        name="name"
                                        placeholder="Например, Магазин у дома"
                                        value={name}
                                        onChange={(event) => setName(event.target.value)}
                                        maxLength={120}
                                        required
                                        aria-describedby="store-name-hint"
                                    />
                                    <span
                                        id="store-name-hint"
                                        className="text-xs leading-relaxed font-normal text-muted"
                                    >
                                        Будет отображаться в кабинете и на рабочем месте кассира.
                                    </span>
                                </label>
                                <label className={ui.label} htmlFor="store-address">
                                    Адрес
                                    <textarea
                                        className={ui.input + " min-h-30 resize-y leading-relaxed"}
                                        id="store-address"
                                        name="address"
                                        autoComplete="street-address"
                                        placeholder="Город, улица, дом"
                                        rows={3}
                                        value={address}
                                        onChange={(event) => setAddress(event.target.value)}
                                        maxLength={500}
                                        required
                                    />
                                </label>
                                {errorMessage && (
                                    <p className="alert-error" role="alert">
                                        {errorMessage}
                                    </p>
                                )}
                                <div className="store-create-actions">
                                    <button
                                        className={ui.buttonBase + " button-secondary"}
                                        type="button"
                                        onClick={() => navigate("/owner")}
                                    >
                                        Отмена
                                    </button>
                                    <button
                                        className={
                                            ui.buttonBase +
                                            " button-link-primary"
                                        }
                                        type="submit"
                                    >
                                        {isSubmitting ? "Создаём магазин…" : "Создать магазин"}
                                        <span aria-hidden="true">→</span>
                                    </button>
                                </div>
                            </fieldset>
                        </form>
                    </section>
                    <aside className="min-w-0">
                        <span className={ui.eyebrow}>ПРЕДПРОСМОТР</span>
                        <p className="mt-2 mb-4 text-xs text-muted">Так магазин будет выглядеть в вашем списке.</p>
                        <article className="store-preview">
                            <div className="row-between">
                                <span className="icon-tile" aria-hidden="true">
                                    ▦
                                </span>
                                <span className="store-preview-badge">
                                    Новый магазин
                                </span>
                            </div>
                            <h3 className={ui.subheading}>{name.trim() || "Название магазина"}</h3>
                            <p>{address.trim() || "Здесь появится адрес"}</p>
                            <span className="card-footer">
                                Товары, остатки и касса <b aria-hidden="true">→</b>
                            </span>
                        </article>
                        <div className="store-next-steps">
                            <h2 className={ui.heading}>Что дальше?</h2>
                            <ol>
                                <li>
                                    <strong>Добавьте категории</strong>
                                    <span>Разделите товары на удобные группы.</span>
                                </li>
                                <li>
                                    <strong>Заполните каталог</strong>
                                    <span>Укажите цены и начальные остатки.</span>
                                </li>
                                <li>
                                    <strong>Создайте кассиров</strong>
                                    <span>Добавьте сотрудников для работы на кассе.</span>
                                </li>
                            </ol>
                        </div>
                    </aside>
                </div>
            </div>
        </main>
    );
};

export default CreateStorePage;
