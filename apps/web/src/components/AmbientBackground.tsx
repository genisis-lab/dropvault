import { Canvas } from "@react-three/fiber"
import { Float, Icosahedron, MeshDistortMaterial } from "@react-three/drei"
import { Suspense } from "react"

// Lightweight, lazy 3D ambient backdrop. Kept subtle so the core UI stays fast.
function Blobs() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 5]} intensity={1.2} />
      <Float speed={1.4} rotationIntensity={1.1} floatIntensity={1.6}>
        <Icosahedron args={[1.6, 4]} position={[-2.4, 0.6, 0]}>
          <MeshDistortMaterial color="#6366f1" speed={1.5} distort={0.4} roughness={0.2} />
        </Icosahedron>
      </Float>
      <Float speed={1.1} rotationIntensity={0.8} floatIntensity={1.2}>
        <Icosahedron args={[1.1, 4]} position={[2.6, -0.8, -1]}>
          <MeshDistortMaterial color="#818cf8" speed={1.2} distort={0.5} roughness={0.15} />
        </Icosahedron>
      </Float>
    </>
  )
}

export default function AmbientBackground() {
  const camera = { position: [0, 0, 6] as [number, number, number], fov: 50 }
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 opacity-60">
      <Canvas camera={camera} dpr={[1, 1.5]}>
        <Suspense fallback={null}>
          <Blobs />
        </Suspense>
      </Canvas>
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-ink/40 to-ink" />
    </div>
  )
}
