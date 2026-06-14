import { motion } from "framer-motion"

export default function Logo({ size = 26 }: { size?: number }) {
  const initial = { rotate: -12, scale: 0.8, opacity: 0 }
  const animate = { rotate: 0, scale: 1, opacity: 1 }
  const transition = { type: "spring" as const, stiffness: 200, damping: 14 }
  const boxStyle = { width: size + 10, height: size + 10 }

  return (
    <div className="flex items-center gap-2">
      <motion.div
        initial={initial}
        animate={animate}
        transition={transition}
        className="grid place-items-center rounded-xl bg-gradient-to-br from-drift-500 via-glow-500 to-blush-500 shadow-md shadow-glow-500/20"
        style={boxStyle}
      >
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path
            d="M5 16a4 4 0 0 1 .9-7.9A5 5 0 0 1 16 7a3.5 3.5 0 0 1 .6 6.96"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 10.5v7m0 0 2.4-2.4M12 17.5l-2.4-2.4"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </motion.div>
      <span className="text-[17px] font-bold tracking-tight text-slate-800">
        Drop<span className="text-gradient">vault</span>
      </span>
    </div>
  )
}
