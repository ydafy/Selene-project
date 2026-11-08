export const RANK_CONFIG = {
  QUALITY_FLOOR: 75,
  LEVELS: [
    {
      name: 'Novato',
      min: 0,
      max: 2,
      icon: '🐣',
      color: 'text-blue-light bg-white/5 border-white/10',
      instruction:
        'Auditoría Exhaustiva: Usuario nuevo. Valida benchmark vs DB y legibilidad total.',
    },
    {
      name: 'Activo',
      min: 3,
      max: 10,
      icon: '✅',
      color: 'text-forest bg-forest/10 border-forest/20',
      instruction:
        'Auditoría Estándar: Revisa coherencia entre modelo y benchmark. Historial confiable.',
    },
    {
      name: 'Elite',
      min: 11,
      max: 30,
      icon: '🔥',
      color: 'text-lion bg-lion/10 border-lion/20',
      instruction:
        'Revisión Rápida: Confianza alta. Solo asegura fotos correctas y benchmark legible.',
    },
    {
      name: 'Legend',
      min: 31,
      max: Infinity,
      icon: '💎',
      color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
      instruction:
        'Paso Prioritario: Socio VIP. Revisión de cortesía y agradecimiento en la nota.',
    },
  ],
};

export const getRank = (soldCount: number, ratio: number) => {
  // 1. Verificación de Calidad (Piso del 75%)
  if (ratio < RANK_CONFIG.QUALITY_FLOOR && soldCount > 0) {
    return {
      label: 'En Observación',
      color: 'text-fire bg-fire/10 border-fire/20',
      icon: '⚠️',
      description: 'Usuario con alto índice de rechazos técnicos.',
    };
  }

  // 2. Encontrar el nivel por ventas
  const level =
    RANK_CONFIG.LEVELS.find((l) => soldCount >= l.min && soldCount <= l.max) ||
    RANK_CONFIG.LEVELS[0];

  return {
    label: level.name,
    color: level.color,
    icon: level.icon,
    description: `Vendedor con ${soldCount} ventas exitosas.`,
  };
};
