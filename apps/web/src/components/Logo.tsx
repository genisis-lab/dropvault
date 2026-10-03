export default function Logo({ size = 24 }: { size?: number }) {
  const boxStyle = { width: size + 12, height: size + 12 };
  return (
    <div className="flex items-center gap-2" data-ui="logo">
      <div
        className="grid place-items-center rounded-xl bg-[#0b57d0] text-white"
        style={boxStyle}
        aria-hidden="true"
      >
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path
            d="M5 16a4 4 0 0 1 .9-7.9A5 5 0 0 1 16 7a3.5 3.5 0 0 1 .6 6.96"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 10.5v7m0 0 2.4-2.4M12 17.5l-2.4-2.4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span className="font-display text-[22px] leading-none text-muted">
        Dropvault
      </span>
    </div>
  );
}
