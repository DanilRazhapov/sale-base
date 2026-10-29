import { useEffect, useRef, useState, type FormEvent } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";
import "../css/AppPages.css";

type Store = {
  id: string;
  name: string;
  address: string | null;
};

type CreatedCashier = {
  id: string;
  name: string;
};

function OwnerPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [isLoadingStores, setIsLoadingStores] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [createdCashier, setCreatedCashier] = useState<CreatedCashier | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    async function loadStores() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error("Войдите в аккаунт снова.");
        const { data, error } = await supabase
          .from("store_members")
          .select("stores!inner(id, name, address, is_active)")
          .eq("user_id", user.id)
          .eq("role", "owner")
          .eq("is_active", true)
          .eq("stores.is_active", true);

        if (error) throw error;

        const availableStores = (data ?? []).map((row) => row.stores as unknown as Store)
          .sort((a, b) => a.name.localeCompare(b.name));
        setStores(availableStores);
        setStoreId(availableStores[0]?.id ?? "");
      } catch {
        setErrorMessage("Не удалось загрузить магазины. Проверьте подключение и авторизацию.");
      } finally {
        setIsLoadingStores(false);
      }
    }

    loadStores();
  }, []);

  async function handleCreateCashier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setErrorMessage("");
    setCreatedCashier(null);

    if (!storeId) {
      setErrorMessage("Выберите магазин.");
      return;
    }

    if (!name.trim()) { setErrorMessage("Введите имя кассира."); return; }
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

    if (!data?.cashier?.id) { setErrorMessage("Сервис не подтвердил создание кассира."); return; }
    setCreatedCashier(data.cashier);
    setName("");
    setPin("");
    } catch { setErrorMessage("Не удалось создать кассира. Проверьте подключение."); }
    finally { submitting.current = false; setIsSubmitting(false); }
  }

  return (
    <main className="app-page"><div className="app-shell">
      <header className="app-topbar">
        <Link className="app-brand" to="/"><span className="app-brand-mark">S</span>SaleBase</Link>
        <nav aria-label="Основная навигация"><Link to="/">Главная</Link><Link to="/owner" aria-current="page">Магазины</Link><Link className="app-button" to="/cashier">Открыть кассу ↗</Link></nav>
      </header>
      <div className="app-page-heading">
        <div><span className="app-eyebrow">КАБИНЕТ ВЛАДЕЛЬЦА</span><h1>Мои магазины</h1><p>Управляйте товарами и остатками, следите за сменами и добавляйте кассиров.</p></div>
        <Link className="app-button app-button-primary" to="/store/new"><span aria-hidden="true">＋</span>Создать магазин</Link>
      </div>
      <div className="owner-layout">
        <section aria-labelledby="owner-stores-title">
          <div className="owner-list-heading"><h2 id="owner-stores-title">Ваши магазины</h2>{!isLoadingStores && <span className="app-count">{stores.length}</span>}</div>
          {isLoadingStores ? <div aria-busy="true"><p className="app-muted" role="status">Загружаем магазины…</p><div className="owner-store-grid" aria-hidden="true"><div className="owner-loading" /><div className="owner-loading" /></div></div> : stores.length ? <div className="owner-store-grid">
            {stores.map((store) => <Link className="owner-store-card" key={store.id} to={`/store/${store.id}`}>
              <div className="owner-store-card-top"><span className="app-tile-icon" aria-hidden="true">▦</span><span className="owner-store-badge"><span aria-hidden="true">●</span>Активен</span></div>
              <h3>{store.name}</h3><p>{store.address || "Адрес не указан"}</p><span className="owner-store-card-footer">Товары, остатки и касса <b aria-hidden="true">→</b></span>
            </Link>)}
          </div> : <div className="owner-empty"><span className="app-tile-icon" aria-hidden="true">▦</span><h3>Здесь будут ваши магазины</h3><p>Добавьте первый магазин, чтобы создать каталог товаров и начать учёт.</p><Link className="app-button app-button-primary" to="/store/new">＋ Добавить магазин</Link></div>}
        </section>
        <aside className="owner-sidebar" aria-labelledby="create-cashier-title">
          <span className="app-tile-icon app-tile-icon-green" aria-hidden="true">＋</span><h2 id="create-cashier-title">Новый кассир</h2><p>Добавьте сотрудника в магазин. Он сможет войти на кассе по имени и PIN.</p>
          <form className="app-form" onSubmit={handleCreateCashier} aria-busy={isSubmitting}>
            <fieldset disabled={isLoadingStores || isSubmitting || stores.length === 0}>
              <label htmlFor="cashier-store">Магазин<select id="cashier-store" value={storeId} onChange={(event) => setStoreId(event.target.value)} required>
                {!stores.length && <option value="">Сначала добавьте магазин</option>}{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select></label>
              <label htmlFor="cashier-name">Имя кассира<input id="cashier-name" placeholder="Например, Айгуль" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
              <label htmlFor="cashier-pin">PIN<input id="cashier-pin" type="password" inputMode="numeric" autoComplete="new-password" placeholder="От 4 до 12 цифр" pattern="[0-9]{4,12}" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} minLength={4} maxLength={12} required /><span className="owner-form-hint">Используется для входа на рабочем планшете.</span></label>
              <button className="app-button app-button-primary app-button-full" type="submit">{isSubmitting ? "Создаём кассира…" : "Создать кассира"}<span aria-hidden="true">→</span></button>
            </fieldset>
          </form>
          {errorMessage && <p className="app-message app-message-error" role="alert">{errorMessage}</p>}
          {createdCashier && <p className="app-message app-message-success" role="status">Кассир «{createdCashier.name}» создан.</p>}
        </aside>
      </div>
    </div></main>
  );
}
export default OwnerPage;
