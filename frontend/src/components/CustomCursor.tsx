"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, useSpring, useMotionValue } from "framer-motion";

const TRAIL_COUNT = 20;

export const CustomCursor: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const cursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const trailRef = useRef<{ x: number; y: number }[]>(
    Array(TRAIL_COUNT).fill({ x: 0, y: 0 })
  );

  // Main cursor motion values
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Smooth springs for the main cursor
  const springConfig = { damping: 30, stiffness: 300 };
  const cursorX = useSpring(mouseX, springConfig);
  const cursorY = useSpring(mouseY, springConfig);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isVisible) setIsVisible(true);
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
      cursorRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseLeave = () => setIsVisible(false);
    const handleMouseEnter = () => setIsVisible(true);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("mouseenter", handleMouseEnter);

    // Update trail
    let animationFrame: number;
    const updateTrail = () => {
      const newTrail = [...trailRef.current];
      
      // The first point follows the cursor
      newTrail[0] = cursorRef.current;

      // Each following point follows the previous one with a delay/easing
      for (let i = 1; i < TRAIL_COUNT; i++) {
        const prev = newTrail[i - 1];
        const current = newTrail[i];
        
        // Easing for trailing effect - slightly slower for a longer tail
        newTrail[i] = {
          x: current.x + (prev.x - current.x) * (0.2 + (i * 0.01)),
          y: current.y + (prev.y - current.y) * (0.2 + (i * 0.01)),
        };
      }
      
      trailRef.current = newTrail;
      animationFrame = requestAnimationFrame(updateTrail);
    };
    
    updateTrail();

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("mouseenter", handleMouseEnter);
      cancelAnimationFrame(animationFrame);
    };
  }, [isVisible, mouseX, mouseY]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-9999">
      <style>{`
        * {
          cursor: none !important;
        }
        button, a, input, textarea, [role="button"], select {
          cursor: none !important;
        }
      `}</style>

      {/* Trailing Dots - Comet Effect */}
      {trailRef.current.map((point, index) => {
        // Skip the first few to avoid overlapping the main cursor too much
        if (index === 0) return null;
        
        const size = Math.max(2, 12 - (index * 0.6));
        const opacity = Math.max(0, 0.6 - (index / TRAIL_COUNT) * 0.6);
        const hue = 260 + (index * 4); // Progressive hue shift
        
        return (
          <div
            key={index}
            className="absolute rounded-full"
            style={{
              left: point.x,
              top: point.y,
              width: `${size}px`,
              height: `${size}px`,
              transform: "translate(-50%, -50%)",
              backgroundColor: `hsla(${hue}, 80%, 65%, ${opacity})`,
              filter: `blur(${index * 0.3}px)`,
              boxShadow: index < 5 ? `0 0 ${10 - index}px hsla(${hue}, 80%, 65%, 0.3)` : 'none',
            }}
          />
        );
      })}

      {/* Main Cursor Handle - Radial Gradient */}
      <motion.div
        style={{
          x: cursorX,
          y: cursorY,
          translateX: "-50%",
          translateY: "-50%",
        }}
        className="absolute w-7 h-7 rounded-full flex items-center justify-center"
      >
        <div 
            className="w-full h-full rounded-full bg-radial-gradient from-purple-400 via-violet-600 to-indigo-800 shadow-[0_0_20px_rgba(168,85,247,0.6)]"
            style={{
                background: "radial-gradient(circle, rgba(192,132,252,1) 0%, rgba(139,92,246,1) 50%, rgba(79,70,229,1) 100%)"
            }}
        />
        {/* Inner Luminous Point */}
        <div className="absolute w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_10px_white]" />
      </motion.div>
    </div>
  );
};
