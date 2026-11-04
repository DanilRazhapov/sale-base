const paths = {
    refresh: "M20 7v5h-5M4 17v-5h5M5.5 8a7 7 0 0 1 12-2l2.5 3M4 15l2.5 3A7 7 0 0 0 19 16",
    clock: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    history: "M4 11a8 8 0 1 1 2.3 6.7M4 6v5h5m3-3v4l3 2",
    logout: "M12 5H5v14h7m2-11 4 4-4 4m-5-4h9",
    search: "M16.5 16.5 21 21m-2.5-10.5a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    box: "m12 3 9 5v8l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5m-9 5v8m-4.5-15.5 9 5",
    basket: "m4 10 2 9h12l2-9M3 10h18m-14 0 3-5m7 5-3-5m-4 8v3m4-3v3",
    plus: "M12 5v14M5 12h14",
    close: "m6 6 12 12M18 6 6 18",
    arrow: "M4 12h15m-6-6 6 6-6 6",
} as const;

export function PosIcon({ name }: { name: keyof typeof paths }) {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d={paths[name]} />
        </svg>
    );
}
