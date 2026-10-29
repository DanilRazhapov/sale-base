import { useRef, useState, type FormEvent } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

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
        <main>
            <h1>Создать магазин</h1>
            <form onSubmit={handleSubmit} aria-busy={isSubmitting}>
                <label htmlFor="store-name">Имя магазина</label>
                <input
                    id="store-name"
                    name="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    disabled={isSubmitting}
                    required
                />

                <label htmlFor="store-address">Адрес</label>
                <input
                    id="store-address"
                    name="address"
                    autoComplete="street-address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    maxLength={500}
                    disabled={isSubmitting}
                    required
                />

                <button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Создание..." : "Создать магазин"}
                </button>
                {errorMessage && <p role="alert">{errorMessage}</p>}
            </form>
            <Link to="/">На главную</Link>
        </main>
    );
};

export default CreateStorePage;
