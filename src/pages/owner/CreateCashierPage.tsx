import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";

import { Link, useOutletContext } from "react-router-dom";
import type { OwnerLayoutContext } from "../../layouts/OwnerLayout";
import { ui } from "../../lib/ui";

type CreatedCashier = {
    id: string;
    name: string;
};

export function CreateCashierPage() {
    const { stores, isLoadingStores, storesError, selectedStoreId } = useOutletContext<OwnerLayoutContext>();
    const [cashierStoreId, setCashierStoreId] = useState("");
    const storeId = cashierStoreId
        ? stores.find((store) => store.id === cashierStoreId)?.id ?? ""
        : selectedStoreId ?? stores[0]?.id ?? "";

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [createdCashier, setCreatedCashier] = useState<CreatedCashier | null>(null);
    const submitting = useRef(false);

    const [name, setName] = useState("");
    const [pin, setPin] = useState("");

    async function handleCreateCashier(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting.current) return;
        setErrorMessage("");
        setCreatedCashier(null);

        if (!storeId) {
            setErrorMessage("Выберите магазин.");
            return;
        }

        if (!name.trim()) {
            setErrorMessage("Введите имя кассира.");
            return;
        }
        if (!/^[0-9]{4,12}$/.test(pin)) {
            setErrorMessage("Введите PIN длиной от 4 до 12 цифр.");
            return;
        }

        submitting.current = true;
        setIsSubmitting(true);
        try {
            const { data, error } = await supabase.functions.invoke("create-cashier", {
                body: { store_id: storeId, name: name.trim(), pin },
            });

            if (error) {
                if (error instanceof FunctionsHttpError) {
                    const response = await error.context.json().catch(() => null);
                    setErrorMessage(response?.error ?? "Не удалось создать кассира.");
                } else {
                    setErrorMessage("Не удалось связаться с сервисом создания кассира.");
                }
                return;
            }

            if (!data?.cashier?.id) {
                setErrorMessage("Сервис не подтвердил создание кассира.");
                return;
            }
            setCreatedCashier(data.cashier);
            setName("");
            setPin("");
        } catch {
            setErrorMessage("Не удалось создать кассира. Проверьте подключение.");
        } finally {
            submitting.current = false;
            setIsSubmitting(false);
        }
    }

    return (
        <main className="owner-page">
            <div>
                <header className="store-page-heading owner-form-heading">
                    <div>
                        <span className="owner-kicker">Кассиры / Создание</span>
                        <h1 className={ui.title}>Новый кассир</h1>
                        <p>Добавьте сотрудника в магазин. Он сможет войти на кассе по имени и PIN.</p>
                    </div>
                    <Link className="button-secondary" to="/">
                        На главную
                    </Link>
                </header>
                <div className="owner-form-layout">
                    <section className="store-create-form space-y-4" aria-labelledby="cashier-details-title">
                        <h2 className={ui.heading} id="cashier-details-title">
                            Данные кассира
                        </h2>
                        {isLoadingStores && (
                            <p className={ui.muted} role="status">
                                Загружаем магазины…
                            </p>
                        )}
                        {storesError && (
                            <p className="alert-error" role="alert">
                                {storesError}
                            </p>
                        )}
                        {!isLoadingStores && !storesError && stores.length === 0 && (
                            <p className={ui.muted}>
                                Чтобы добавить кассира, сначала{" "}
                                <Link className="underline" to="/store/new">
                                    создайте магазин
                                </Link>
                                .
                            </p>
                        )}
                        <form onSubmit={handleCreateCashier} aria-busy={isSubmitting}>
                            <fieldset
                                className={ui.fieldset}
                                disabled={isLoadingStores || isSubmitting || !stores.length}
                            >
                                <label className={ui.label} htmlFor="cashier-store">
                                    Магазин
                                    <select
                                        className={ui.input}
                                        id="cashier-store"
                                        value={storeId}
                                        onChange={(event) => setCashierStoreId(event.target.value)}
                                        required
                                    >
                                        {!storeId && (
                                            <option value="">
                                                {stores.length ? "Выберите магазин" : "Сначала добавьте магазин"}
                                            </option>
                                        )}
                                        {stores.map((store) => (
                                            <option key={store.id} value={store.id}>
                                                {store.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className={ui.label} htmlFor="cashier-name">
                                    Имя кассира
                                    <input
                                        className={ui.input}
                                        id="cashier-name"
                                        placeholder="Например, Айгуль"
                                        autoComplete="off"
                                        value={name}
                                        onChange={(event) => setName(event.target.value)}
                                        maxLength={120}
                                        required
                                    />
                                </label>
                                <label className={ui.label} htmlFor="cashier-pin">
                                    PIN
                                    <input
                                        className={ui.input}
                                        id="cashier-pin"
                                        type="password"
                                        inputMode="numeric"
                                        autoComplete="new-password"
                                        placeholder="От 4 до 12 цифр"
                                        pattern="[0-9]{4,12}"
                                        value={pin}
                                        onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                                        minLength={4}
                                        maxLength={12}
                                        required
                                    />
                                    <span className="text-xs font-normal text-muted">
                                        Используется для входа на рабочем планшете.
                                    </span>
                                </label>
                                <button className={ui.buttonBase + " button-submit"} type="submit">
                                    {isSubmitting ? "Создаём кассира…" : "Создать кассира"}
                                    <span aria-hidden="true">→</span>
                                </button>
                            </fieldset>
                        </form>

                        {errorMessage && (
                            <p className="alert-error" role="alert">
                                {errorMessage}
                            </p>
                        )}
                        {createdCashier && (
                            <p className="alert-success" role="status">
                                Кассир «{createdCashier.name}» создан.
                            </p>
                        )}
                    </section>
                    <aside className="owner-form-aside cashier-access-note">
                        <span className="owner-kicker">Доступ к кассе</span>
                        <h2 className={ui.heading}>Вход кассира</h2>
                        <p>
                            Передайте кассиру имя и PIN-код, которые указали в форме. Эти данные понадобятся для входа
                            на кассовом устройстве.
                        </p>
                    </aside>
                </div>
            </div>
        </main>
    );
}
