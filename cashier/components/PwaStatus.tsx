import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt(): Promise<void> };

export function PwaStatus() {
    const [offline, setOffline] = useState(!navigator.onLine);
    const [ready, setReady] = useState(false);
    const [update, setUpdate] = useState<ServiceWorker | null>(null);
    const [install, setInstall] = useState<InstallPrompt | null>(null);
    useEffect(() => {
        let active = true;
        let registration: ServiceWorkerRegistration | undefined;
        let installing: ServiceWorker | null = null;
        const connection = () => setOffline(!navigator.onLine);
        const checkUpdate = () => {
            if (active) setUpdate(navigator.serviceWorker.controller ? registration?.waiting ?? null : null);
        };
        const watchInstallation = () => {
            installing?.removeEventListener("statechange", checkUpdate);
            installing = registration?.installing ?? null;
            installing?.addEventListener("statechange", checkUpdate);
            checkUpdate();
        };
        const prompt = (event: Event) => { event.preventDefault(); setInstall(event as InstallPrompt); };
        const installed = () => setInstall(null);
        window.addEventListener("online", connection);
        window.addEventListener("offline", connection);
        window.addEventListener("beforeinstallprompt", prompt);
        window.addEventListener("appinstalled", installed);
        if (import.meta.env.PROD && "serviceWorker" in navigator) {
            void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(result => {
                if (!active) return;
                registration = result;
                registration.addEventListener("updatefound", watchInstallation);
                watchInstallation();
            }).catch(error => console.error("Не удалось подготовить приложение к работе без сети", error));
            void navigator.serviceWorker.ready.then(() => { if (active) setReady(true); });
        }
        return () => {
            active = false;
            registration?.removeEventListener("updatefound", watchInstallation);
            installing?.removeEventListener("statechange", checkUpdate);
            window.removeEventListener("online", connection);
            window.removeEventListener("offline", connection);
            window.removeEventListener("beforeinstallprompt", prompt);
            window.removeEventListener("appinstalled", installed);
        };
    }, []);
    if (!offline && !ready && !update && !install) return null;
    return <aside className="pwa-status" aria-label="Состояние приложения">
        <span role="status">{offline
            ? "Нет интернета. Сохранённые операции отправятся после восстановления связи."
            : update ? "Доступно обновление кассы."
            : ready ? "Приложение сохранено для открытия без интернета." : ""}</span>
        {!offline && update && <button type="button" onClick={() => {
            navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
            update.postMessage("SKIP_WAITING");
        }}>Обновить кассу</button>}
        {install && <button type="button" onClick={() => {
            void install.prompt().catch(() => undefined);
            setInstall(null);
        }}>Установить SaleBase Кассу</button>}
    </aside>;
}
