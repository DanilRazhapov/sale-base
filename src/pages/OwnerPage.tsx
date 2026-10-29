import { useEffect, useState, type FormEvent } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";
import "./StorePage.css";

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
    setErrorMessage("");
    setCreatedCashier(null);

    if (!storeId) {
      setErrorMessage("Выберите магазин.");
      return;
    }

    setIsSubmitting(true);
    const { data, error } = await supabase.functions.invoke("create-cashier", {
      body: { store_id: storeId, name, pin },
    });
    setIsSubmitting(false);

    if (error) {
      if (error instanceof FunctionsHttpError) {
        const response = await error.context.json().catch(() => null);
        setErrorMessage(response?.error ?? "Не удалось создать кассира.");
      } else {
        setErrorMessage("Не удалось связаться с сервисом создания кассира.");
      }
      return;
    }

    setCreatedCashier(data.cashier);
    setName("");
    setPin("");
  }

  return (
    <main className="store-workspace">
      <h1>Мои магазины</h1>
      <Link to="/store/new">Создать магазин</Link>
      <div className="owner-stores">
        {stores.map((store) => <Link key={store.id} to={`/store/${store.id}`}>
          <h2>{store.name}</h2><p>{store.address || "Адрес не указан"}</p><span>Товары, остатки и касса →</span>
        </Link>)}
      </div>
      <h2>Создать кассира</h2>
      <form onSubmit={handleCreateCashier}>
        <label>
          Магазин
          <select
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            disabled={isLoadingStores || isSubmitting || stores.length === 0}
            required
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </label>

        <label>
          Имя кассира
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
        </label>

        <label>
          PIN
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4,12}"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            minLength={4}
            maxLength={12}
            required
          />
        </label>

        <button type="submit" disabled={isLoadingStores || isSubmitting || stores.length === 0}>
          {isSubmitting ? "Создание..." : "Создать кассира"}
        </button>
      </form>

      {isLoadingStores && <p>Загрузка магазинов...</p>}
      {!isLoadingStores && stores.length === 0 && <p>Нет доступных активных магазинов.</p>}
      {errorMessage && <p role="alert">{errorMessage}</p>}
      {createdCashier && <p>Кассир «{createdCashier.name}» создан.</p>}
    </main>
  );
}

export default OwnerPage;
