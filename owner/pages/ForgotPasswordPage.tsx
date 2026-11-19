import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ui } from "../../shared/lib/ui";
import { AuthLayout } from "../components/AuthLayout";
import { supabase } from "../lib/supabase";

type Step = "email" | "code" | "password";

export default function ForgotPasswordPage() {
    const navigate = useNavigate();
    const [step, setStep] = useState<Step>("email");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [errorMessage, setErrorMessage] = useState("");
    const submitting = useRef(false);

    useEffect(() => {
        if (cooldown < 1) return;
        const timeout = window.setTimeout(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
        return () => window.clearTimeout(timeout);
    }, [cooldown]);

    async function sendCode(event?: FormEvent<HTMLFormElement>) {
        event?.preventDefault();
        if (submitting.current || (step === "code" && cooldown > 0)) return;
        submitting.current = true;
        setBusy(true);
        setErrorMessage("");
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
            if (error) {
                setErrorMessage(error.status === 429
                    ? "Слишком много запросов. Попробуйте позднее."
                    : "Не удалось отправить запрос. Проверьте подключение и повторите попытку.");
                return;
            }
            setCode("");
            setCooldown(60);
            setStep("code");
        } catch {
            setErrorMessage("Не удалось подключиться к серверу. Попробуйте снова.");
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    }

    async function verifyCode(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting.current || !/^[0-9]{6}$/.test(code)) return;
        submitting.current = true;
        setBusy(true);
        setErrorMessage("");
        try {
            const { data, error } = await supabase.auth.verifyOtp({
                email: email.trim().toLowerCase(),
                token: code,
                type: "recovery",
            });
            if (error || !data.session) {
                setErrorMessage("Неверный или просроченный код. Проверьте письмо или запросите новый.");
                return;
            }
            setStep("password");
        } catch {
            setErrorMessage("Не удалось проверить код. Проверьте подключение.");
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    }

    async function savePassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting.current) return;
        if (password.length < 8) {
            setErrorMessage("Пароль должен содержать не менее 8 символов.");
            return;
        }
        if (password !== confirmPassword) {
            setErrorMessage("Пароли не совпадают.");
            return;
        }
        submitting.current = true;
        setBusy(true);
        setErrorMessage("");
        try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) {
                setErrorMessage("Не удалось сохранить пароль. Проверьте требования к паролю.");
                return;
            }
            await supabase.auth.signOut();
            navigate("/login/owner", { replace: true, state: { passwordReset: true } });
        } catch {
            setErrorMessage("Не удалось завершить восстановление. Попробуйте ещё раз.");
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    }

    return (
        <AuthLayout
            title={step === "email" ? "Забыли пароль?" : step === "code" ? "Подтвердите email" : "Новый пароль"}
            description={step === "email"
                ? "Укажите адрес владельца. Если аккаунт существует, на почту придёт шестизначный код."
                : step === "code"
                    ? "Введите одноразовый код из письма. Проверьте папку «Спам», если письма нет."
                    : "Код подтверждён. Теперь можно установить новый пароль."}
            footer={<Link to="/login/owner">Вернуться ко входу</Link>}
        >
            {step === "email" && (
                <form onSubmit={sendCode} aria-busy={busy}>
                    <fieldset className={ui.fieldset} disabled={busy}>
                        <label className={ui.label} htmlFor="recovery-email">
                            Электронная почта
                            <input className={ui.input} id="recovery-email" type="email" autoComplete="email"
                                placeholder="you@example.com" required value={email}
                                onChange={(event) => setEmail(event.target.value)} />
                        </label>
                        {errorMessage && <p className="alert-error" role="alert">{errorMessage}</p>}
                        <button className={ui.buttonBase + " button-submit"} type="submit">
                            {busy ? "Отправляем…" : "Получить код"}<span aria-hidden="true">→</span>
                        </button>
                    </fieldset>
                </form>
            )}

            {step === "code" && (
                <form onSubmit={verifyCode} aria-busy={busy}>
                    <fieldset className={ui.fieldset} disabled={busy}>
                        <p className="owner-auth-hint">Если аккаунт существует, письмо отправлено на {email.trim()}.</p>
                        <label className={ui.label} htmlFor="recovery-code">
                            Код из письма
                            <input className={ui.input} id="recovery-code" type="text"
                                inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
                                maxLength={6} required placeholder="000000" value={code}
                                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                        </label>
                        {errorMessage && <p className="alert-error" role="alert">{errorMessage}</p>}
                        <button className={ui.buttonBase + " button-submit"} type="submit" disabled={code.length !== 6}>
                            {busy ? "Проверяем…" : "Подтвердить код"}<span aria-hidden="true">→</span>
                        </button>
                    </fieldset>
                    <div className="owner-auth-actions">
                        <button type="button" className="owner-auth-text-button" disabled={busy || cooldown > 0}
                            onClick={() => void sendCode()}>
                            {cooldown > 0 ? `Отправить повторно через ${cooldown} с` : "Отправить код повторно"}
                        </button>
                        <button type="button" className="owner-auth-text-button" disabled={busy}
                            onClick={() => { setStep("email"); setErrorMessage(""); }}>
                            Изменить email
                        </button>
                    </div>
                </form>
            )}

            {step === "password" && (
                <form onSubmit={savePassword} aria-busy={busy}>
                    <fieldset className={ui.fieldset} disabled={busy}>
                        <label className={ui.label} htmlFor="recovery-new-password">
                            Новый пароль
                            <input className={ui.input} id="recovery-new-password" type="password"
                                autoComplete="new-password" minLength={8} required value={password}
                                onChange={(event) => setPassword(event.target.value)} />
                        </label>
                        <label className={ui.label} htmlFor="recovery-confirm-password">
                            Повторите пароль
                            <input className={ui.input} id="recovery-confirm-password" type="password"
                                autoComplete="new-password" minLength={8} required value={confirmPassword}
                                onChange={(event) => setConfirmPassword(event.target.value)} />
                        </label>
                        {errorMessage && <p className="alert-error" role="alert">{errorMessage}</p>}
                        <button className={ui.buttonBase + " button-submit"} type="submit">
                            {busy ? "Сохраняем…" : "Сохранить пароль"}<span aria-hidden="true">→</span>
                        </button>
                    </fieldset>
                </form>
            )}
        </AuthLayout>
    );
}
