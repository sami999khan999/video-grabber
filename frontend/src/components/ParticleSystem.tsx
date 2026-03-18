"use client";

import React, { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  color: string;
  opacity: number;
  life: number;
  maxLife: number;
}

export const ParticleSystem: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    const createAmbientParticle = () => {
      return {
        x: Math.random() * canvas.width,
        y: canvas.height + 20,
        size: Math.random() * 2 + 0.5,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: -(Math.random() * 0.8 + 0.2),
        color: `hsla(${260 + Math.random() * 40}, 70%, 75%, 1)`,
        opacity: Math.random() * 0.4 + 0.1,
        life: 0,
        maxLife: Math.random() * 300 + 200,
      };
    };

    const createBurstParticle = (x: number, y: number) => {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4 + 2;
      return {
        x,
        y,
        size: Math.random() * 3 + 1,
        speedX: Math.cos(angle) * speed,
        speedY: Math.sin(angle) * speed,
        color: `hsla(${280 + Math.random() * 60}, 100%, 70%, 1)`,
        opacity: 1,
        life: 0,
        maxLife: Math.random() * 40 + 30,
      };
    };

    // Initial ambient particles
    for (let i = 0; i < 90; i++) {
      const p = createAmbientParticle();
      p.y = Math.random() * canvas.height;
      particles.current.push(p);
    }

    const handleMouseMove = (e: MouseEvent) => {
      // Spawn burst particles on movement
      for (let i = 0; i < 5; i++) {
        particles.current.push(createBurstParticle(e.clientX, e.clientY));
      }
    };

    window.addEventListener("mousemove", handleMouseMove);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Maintain ambient count (80-100)
      if (particles.current.filter(p => p.maxLife > 100).length < 90) {
        particles.current.push(createAmbientParticle());
      }

      for (let i = particles.current.length - 1; i >= 0; i--) {
        const p = particles.current[i];
        p.life++;
        p.x += p.speedX;
        p.y += p.speedY;
        
        // Slight horizontal drift for ambient particles
        if (p.maxLife > 100) {
          p.speedX += (Math.random() - 0.5) * 0.02;
        } else {
          // Slow down burst particles
          p.speedX *= 0.96;
          p.speedY *= 0.96;
        }

        const opacity = p.opacity * (1 - p.life / p.maxLife);
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color.replace("1)", `${opacity})`);
        
        if (p.maxLife < 100) { // Burst particles glow
            ctx.shadowBlur = 15;
            ctx.shadowColor = p.color;
        } else {
            ctx.shadowBlur = 0;
        }
        
        ctx.fill();

        // Remove dead particles
        if (p.life >= p.maxLife || p.y < -20 || p.x < -20 || p.x > canvas.width + 20) {
          particles.current.splice(i, 1);
        }
      }

      requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ background: "transparent" }}
    />
  );
};
