import { useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import { ui } from "../../lib/ui";
import type { Product, RunStoreAction } from "./types";

type Props = {
    storeId: string;
    products: Product[];
    busy: boolean;
    runAction: RunStoreAction;
};

export function OwnerMovementForm({ storeId, products, busy, runAction }: Props) {
    const [movement, setMovement] = useState({
        product: "",
        kind: "receipt",
        quantity: "1",
        note: "",
    });

    function recordMovement(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void runAction(async () => {
            const { error } = await supabase.rpc("record_store_movement", {
                p_store_id: storeId,
                p_product_id: movement.product,
                p_kind: movement.kind,
                p_quantity: Number(movement.quantity),
                p_note: movement.note,
                p_shift_id: null,
            });
            if (error) throw error;
            setMovement({ ...movement, quantity: "1", note: "" });
        }, "Операция проведена, остаток обновлён.");
    }

    return (
        <section className="store-section">
            <h2 className={ui.heading}>Приход и списание владельцем</h2>
            <p>Эти операции записываются на ваш аккаунт. Продажи и действия кассира проводятся на рабочем планшете.</p>
            <form onSubmit={recordMovement}>
                <fieldset className={ui.fieldset} disabled={busy || !products.length}>
                    <label className={ui.label}>
                        Товар
                        <select
                            className={ui.input}
                            required
                            value={movement.product}
                            onChange={(e) =>
                                setMovement({
                                    ...movement,
                                    product: e.target.value,
                                })
                            }
                        >
                            <option value="">Выберите товар</option>
                            {products.map((product) => (
                                <option key={product.id} value={product.id}>
                                    {product.name} — {product.stock ?? 0} {product.unit}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className={ui.label}>
                        Операция
                        <select
                            className={ui.input}
                            value={movement.kind}
                            onChange={(e) =>
                                setMovement({
                                    ...movement,
                                    kind: e.target.value,
                                })
                            }
                        >
                            <option value="receipt">Приход</option>
                            <option value="writeoff">Списание</option>
                        </select>
                    </label>
                    <label className={ui.label}>
                        Количество
                        <input
                            className={ui.input}
                            required
                            type="number"
                            min="0.001"
                            max="99999999999.999"
                            step="0.001"
                            value={movement.quantity}
                            onChange={(e) =>
                                setMovement({
                                    ...movement,
                                    quantity: e.target.value,
                                })
                            }
                        />
                    </label>
                    <label className={ui.label}>
                        Комментарий
                        <input
                            className={ui.input}
                            maxLength={500}
                            value={movement.note}
                            onChange={(e) =>
                                setMovement({
                                    ...movement,
                                    note: e.target.value,
                                })
                            }
                        />
                    </label>
                    <button className={ui.button}>Провести операцию</button>
                </fieldset>
            </form>
        </section>
    );
}
