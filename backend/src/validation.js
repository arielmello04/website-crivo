import { z } from 'zod';

// rótulos amigáveis pros tipos de serviço (chave usada no select do form)
export const SERVICOS = {
  branding:  'Branding & identidade',
  conteudo:  'Conteúdo & redes sociais',
  midia:     'Mídia & performance',
  web:       'Site / landing page',
  combo:     'Combo (mais de um serviço)',
  naosei:    'Ainda não sei — quero conversar',
};

export const briefingSchema = z.object({
  nome: z.string()
    .trim()
    .min(2, 'Nome muito curto')
    .max(120, 'Nome muito longo'),

  empresa: z.string()
    .trim()
    .min(1, 'Empresa é obrigatória')
    .max(160, 'Nome de empresa muito longo'),

  email: z.string()
    .trim()
    .toLowerCase()
    .email('Email inválido')
    .max(160, 'Email muito longo'),

  telefone: z.string()
    .trim()
    .min(8, 'Telefone muito curto')
    .max(30, 'Telefone muito longo'),

  servico: z.enum(Object.keys(SERVICOS), {
    errorMap: () => ({ message: 'Selecione um serviço válido' }),
  }),

  mensagem: z.string()
    .trim()
    .min(10, 'Conta um pouco mais do projeto (mínimo 10 caracteres)')
    .max(5000, 'Mensagem muito longa'),

  // honeypot — campo invisível que bot preenche. Tem que vir vazio.
  website: z.string().max(0, 'spam detectado').optional().or(z.literal('')),
});

export function getServicoLabel(key) {
  return SERVICOS[key] || key;
}
