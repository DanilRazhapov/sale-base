import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt(): Promise<void> };

export function PwaStatus() {
    const [offline, setOffline] = useState(!navigator.onLine);
    const [ready, setReady] = useState(false);
    const [update, setUpdate] = useState(false);
    const [install, setInstall] = useState<InstallPrompt | null>(null);
    useEffect(() => {
        let active = true;
        const connection = () => setOffline(!navigator.onLine);
        const prompt = (event: Event) => { event.preventDefault(); setInstall(event as InstallPrompt); };
        const installed = () => setInstall(null);
        window.addEventListener("online", connection);
        window.addEventListener("offline", connection);
        window.addEventListener("beforeinstallprompt", prompt);
        window.addEventListener("appinstalled", installed);
        if (import.meta.env.PROD && "serviceWorker" in navigator) {
            void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(registration => {
                if (!active) return;
                setUpdate(!!registration.waiting);
                registration.addEventListener("updatefound", () => {
                    registration.installing?.addEventListener("statechange", () => {
                        if (active && registration.waiting && navigator.serviceWorker.controller) setUpdate(true);
                    });
                });
            }).catch(error => console.error("Не удалось подготовить приложение к работе без сети", error));
            void navigator.serviceWorker.ready.then(() => { if (active) setReady(true); });
        }
        return () => {
            active = false;
            window.removeEventListener("online", connection);
            window.removeEventListener("offline", connection);
            window.removeEventListener("beforeinstallprompt", prompt);
            window.removeEventListener("appinstalled", installed);
        };
    }, []);
    if (!offline && !ready && !update && !install) return null;
    return <aside className="pwa-status" aria-label="Состояние приложения">
        <span role="status">{offline
            ? "Нет интернета. Для входа, загрузки данных и сохранения операций восстановите связь."
            : update ? "Доступно обновление. Оно применится после закрытия всех окон кассы."
            : ready ? "Приложение сохранено для открытия без интернета." : ""}</span>
        {install && <button type="button" onClick={() => {
            void install.prompt().catch(() => undefined);
            setInstall(null);
        }}>Установить SaleBase Кассу</button>}
    </aside>;
}
