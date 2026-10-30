import { consentAllows, PREF_CURRENCY_KEY, PREF_LOW_BANDWIDTH_KEY, useConsent } from '../lib/consent';
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getUsdToLrdRate } from '../lib/currency';
import { usePlatformSettings } from '../lib/platformSettingsStore';
import { envConfig } from '../config/env';
import { logger } from '../core/logging/logger';

interface ConfigContextType {
  currency: 'USD' | 'LRD';
  setCurrency: (c: 'USD' | 'LRD') => void;
  formatCurrency: (amountUSD: number | undefined | null, targetCurrency?: 'USD' | 'LRD') => string;
  isLowBandwidthMode: boolean;
  toggleLowBandwidthMode: () => void;
  isOnline: boolean;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export const ConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currency, setCurrencyState] = useState<'USD' | 'LRD'>(() => {
    const saved = consentAllows('preferences') ? localStorage.getItem(PREF_CURRENCY_KEY) : null;
    return saved === 'LRD' ? 'LRD' : envConfig.defaultCurrency;
  });

  const [isLowBandwidthMode, setIsLowBandwidthMode] = useState<boolean>(() => {
    const saved = consentAllows('preferences') ? localStorage.getItem(PREF_LOW_BANDWIDTH_KEY) : null;
    return saved === 'true' || envConfig.enableLowBandwidthMode;
  });

  // Preferences are only written to the device with consent; if consent arrives later, save the current choices.
  const { consent } = useConsent();
  // Re-render consumers when an administrator changes the USD->LRD rate (the rate itself lives in lib/currency).
  const { usdToLrd: adminRate } = usePlatformSettings();
  useEffect(() => {
    if (!consent?.preferences) return;
    localStorage.setItem(PREF_CURRENCY_KEY, currency);
    localStorage.setItem(PREF_LOW_BANDWIDTH_KEY, String(isLowBandwidthMode));
  }, [consent?.preferences, currency, isLowBandwidthMode]);

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      logger.info('NETWORK', 'Device connectivity restored: Online.');
    };
    const handleOffline = () => {
      setIsOnline(false);
      logger.warn('NETWORK', 'Device lost internet connectivity: Offline Mode active.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const setCurrency = (c: 'USD' | 'LRD') => {
    setCurrencyState(c);
    if (consentAllows('preferences')) localStorage.setItem(PREF_CURRENCY_KEY, c);
  };

  const toggleLowBandwidthMode = () => {
    setIsLowBandwidthMode((prev) => {
      const next = !prev;
      if (consentAllows('preferences')) localStorage.setItem(PREF_LOW_BANDWIDTH_KEY, String(next));
      logger.info('CONFIG', `Low-Bandwidth Data Saver mode: ${next ? 'ENABLED' : 'DISABLED'}`);
      return next;
    });
  };

  const formatCurrency = (amountUSD: number | undefined | null, targetCurrency?: 'USD' | 'LRD'): string => {
    if (amountUSD === undefined || amountUSD === null) return 'Negotiable';
    const curr = targetCurrency || currency;

    if (curr === 'LRD') {
      const amountLRD = Math.round(amountUSD * (adminRate ?? getUsdToLrdRate()));
      return `L$ ${amountLRD.toLocaleString()}`;
    }

    return `$${amountUSD.toLocaleString()}`;
  };

  return (
    <ConfigContext.Provider
      value={{
        currency,
        setCurrency,
        formatCurrency,
        isLowBandwidthMode,
        toggleLowBandwidthMode,
        isOnline
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = (): ConfigContextType => {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
};
