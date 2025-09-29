/**
 * Types pour le système de feedback temps réel de l'orchestration
 */

export type OrchestrationPhase = 
  | 'orchestrator' 
  | 'archivist' 
  | 'prompt_enhancer'
  | 'image_generation'
  | 'generating' 
  | 'complete';

export interface LoadingState {
  phase: OrchestrationPhase;
  message: string;
  progress: number; // 0-100
  details?: string;
  icon: string;
  color: string;
}

export interface OrchestrationProgress {
  isActive: boolean;
  currentPhase: OrchestrationPhase;
  phases: LoadingState[];
  startTime: number;
  estimatedDuration: number;
}

export interface PhaseConfig {
  phase: OrchestrationPhase;
  message: string;
  icon: string;
  color: string;
  minProgress: number;
  maxProgress: number;
  estimatedDuration: number;
  needsRotation: boolean; // Nouveau : indique si la phase a besoin de rotation
  rotationInterval?: number; // Intervalle de rotation en ms
  maxMessages?: number; // Nombre max de messages différents
}

export interface DynamicMessage {
  id: string;
  phase: OrchestrationPhase;
  message: string;
  icon: string;
  color: string;
  duration: number; // Durée d'affichage en ms
  conditions?: {
    hasMemory?: boolean;
    hasImage?: boolean;
    isComplex?: boolean;
    isError?: boolean;
  };
}

export interface MessageSequence {
  phase: OrchestrationPhase;
  messages: DynamicMessage[];
  rotationInterval: number; // Changement de message toutes les X ms
  randomize: boolean; // Ordre aléatoire ou séquentiel
  enabled: boolean; // Si la rotation est activée pour cette phase
}

export const ORCHESTRATION_PHASES: PhaseConfig[] = [
  {
    phase: 'orchestrator',
    message: 'Analyse votre message...',
    icon: '🦋',
    color: 'purple',
    minProgress: 0,
    maxProgress: 20,
    estimatedDuration: 1500, // 1.5 secondes
    needsRotation: false // Phase courte, pas de rotation
  },
  {
    phase: 'archivist',
    message: 'Recherche dans vos conversations...',
    icon: '📚',
    color: 'blue',
    minProgress: 20,
    maxProgress: 60,
    estimatedDuration: 5000, // 5 secondes
    needsRotation: true, // Phase moyenne, rotation utile
    rotationInterval: 2500,
    maxMessages: 3
  },
  {
    phase: 'prompt_enhancer',
    message: 'Améliore votre prompt...',
    icon: '🎨',
    color: 'orange',
    minProgress: 60,
    maxProgress: 75,
    estimatedDuration: 2500, // 2.5 secondes
    needsRotation: false // Phase courte, pas de rotation
  },
  {
    phase: 'image_generation',
    message: 'Génère votre image...',
    icon: '🖼️',
    color: 'green',
    minProgress: 75,
    maxProgress: 85,
    estimatedDuration: 15000, // 15 secondes
    needsRotation: true, // Phase longue, rotation essentielle
    rotationInterval: 3000,
    maxMessages: 4
  },
  {
    phase: 'generating',
    message: 'Compose sa réponse...',
    icon: '⛧',
    color: 'green',
    minProgress: 85,
    maxProgress: 100,
    estimatedDuration: 8000, // 8 secondes
    needsRotation: true, // Phase moyenne-longue, rotation utile
    rotationInterval: 2000,
    maxMessages: 3
  },
  {
    phase: 'complete',
    message: 'Terminé',
    icon: '✅',
    color: 'gray',
    minProgress: 100,
    maxProgress: 100,
    estimatedDuration: 0,
    needsRotation: false
  }
];

// Messages dynamiques par phase (seulement pour les phases qui en ont besoin)
export const DYNAMIC_MESSAGES: Record<OrchestrationPhase, DynamicMessage[]> = {
  orchestrator: [
    {
      id: 'orch_1',
      phase: 'orchestrator',
      message: '🦋 Luciole analyse votre message...',
      icon: '🦋',
      color: 'purple',
      duration: 1500
    }
  ],
  
  archivist: [
    {
      id: 'arch_1',
      phase: 'archivist',
      message: '📚 Archiviste fouille dans vos conversations...',
      icon: '📚',
      color: 'blue',
      duration: 2500
    },
    {
      id: 'arch_2',
      phase: 'archivist',
      message: '🔍 Recherche sémantique en cours...',
      icon: '🔍',
      color: 'blue',
      duration: 2500
    },
    {
      id: 'arch_3',
      phase: 'archivist',
      message: '📖 Consultation des archives personnelles...',
      icon: '📖',
      color: 'blue',
      duration: 2500
    }
  ],
  
  prompt_enhancer: [
    {
      id: 'enh_1',
      phase: 'prompt_enhancer',
      message: '🎨 Prompt Enhancer améliore votre demande...',
      icon: '🎨',
      color: 'orange',
      duration: 2500
    }
  ],
  
  image_generation: [
    {
      id: 'img_1',
      phase: 'image_generation',
      message: '🖼️ Génération de l\'image...',
      icon: '🖼️',
      color: 'green',
      duration: 3000
    },
    {
      id: 'img_2',
      phase: 'image_generation',
      message: '🎨 Création artistique en cours...',
      icon: '🎨',
      color: 'green',
      duration: 3000
    },
    {
      id: 'img_3',
      phase: 'image_generation',
      message: '✨ Manifestation visuelle...',
      icon: '✨',
      color: 'green',
      duration: 3000
    },
    {
      id: 'img_4',
      phase: 'image_generation',
      message: '🖌️ Peinture numérique...',
      icon: '🖌️',
      color: 'green',
      duration: 3000
    }
  ],
  
  generating: [
    {
      id: 'gen_1',
      phase: 'generating',
      message: '⛧ Algareth compose sa réponse...',
      icon: '⛧',
      color: 'green',
      duration: 2000
    },
    {
      id: 'gen_2',
      phase: 'generating',
      message: '🔮 Manifestation de la sagesse...',
      icon: '🔮',
      color: 'green',
      duration: 2000
    },
    {
      id: 'gen_3',
      phase: 'generating',
      message: '✨ Création de la réponse divine...',
      icon: '✨',
      color: 'green',
      duration: 2000
    }
  ],
  
  complete: [
    {
      id: 'comp_1',
      phase: 'complete',
      message: '✅ Terminé',
      icon: '✅',
      color: 'gray',
      duration: 1000
    }
  ]
};

export const getPhaseConfig = (phase: OrchestrationPhase): PhaseConfig => {
  return ORCHESTRATION_PHASES.find(p => p.phase === phase) || ORCHESTRATION_PHASES[0];
};

export const createLoadingState = (
  phase: OrchestrationPhase, 
  progress: number, 
  details?: string
): LoadingState => {
  const config = getPhaseConfig(phase);
  return {
    phase,
    message: config.message,
    progress: Math.max(config.minProgress, Math.min(config.maxProgress, progress)),
    details,
    icon: config.icon,
    color: config.color
  };
};

export const shouldRotateMessages = (phase: OrchestrationPhase): boolean => {
  const config = getPhaseConfig(phase);
  return config.needsRotation;
};

export const getRotationInterval = (phase: OrchestrationPhase): number => {
  const config = getPhaseConfig(phase);
  return config.rotationInterval || 2000;
};