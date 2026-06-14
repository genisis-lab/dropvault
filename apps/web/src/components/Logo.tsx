import { motion } from "framer-motion"

export default function Logo({ size = 28 }: { size?: number }) {
  const initial = { rotate: -12, scale: 0.8, opacity: 0 }
  const animate = { rotate: 0, scale: 1, opacity: 1 }
  const transition = { type: "spring" as const, stiffness: 200, damping: 14 }
  const boxStyle = { width: size + 12, height: size + 12 }
  return (
    <div className="flex items-center gap-2">
      <motion.div
        initial={initial}
        animate={animate}
        transition={transition}
        className="grid place-items-center rounded-xl bg-gradient-to-br from-drift-400 via-glow-500 to-blush-500 shadow-lg shadow-glow-600/30"
        style={boxStyle}
      >
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M5 16a4 4 0 0 1 .9-7.9A5 5 0 0 1 16 7a3.5 3.5 0 0 1 .5 6.96" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M12 11v7m0 0 2.5-2.5M12 18l-2.5-2.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.div>
      <span className="text-lg font-extrabold tracking-tight text-gradient">Dropvault</span>
    </div>
  )
}
