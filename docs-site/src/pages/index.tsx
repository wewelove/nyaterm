import React, {useCallback, useEffect, useState} from 'react';
import clsx from 'clsx';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Link from '@docusaurus/Link';
import Translate, {translate} from '@docusaurus/Translate';

import styles from './index.module.css';

type FeatureTab = {
  value: string;
  label: string;
  title: string;
  description: string;
  bullets: string[];
  lightImage: string;
  darkImage: string;
};

type SummaryCard = {
  title: string;
  description: string;
};

type DownloadPlatform = {
  key: string;
  href: string;
};

const downloadPlatforms: DownloadPlatform[] = [
  {
    key: 'windows-x86_64',
    href: 'https://nyaterm.app/download/windows-x86_64',
  },
  {
    key: 'linux-x86_64',
    href: 'https://nyaterm.app/download/linux-x86_64',
  },
  {
    key: 'darwin-x86_64',
    href: 'https://nyaterm.app/download/darwin-x86_64',
  },
  {
    key: 'darwin-aarch64',
    href: 'https://nyaterm.app/download/darwin-aarch64',
  },
];

const featureAutoplayStoppedKey = 'nyaterm-home-feature-tabs-autoplay-stopped';
const featureAutoplayIntervalMs = 4200;

function detectDownloadPlatform(): DownloadPlatform {
  if (typeof navigator === 'undefined') {
    return downloadPlatforms[0];
  }

  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();

  if (platform.includes('mac') || userAgent.includes('mac os')) {
    return downloadPlatforms.find((item) => item.key === 'darwin-x86_64') ?? downloadPlatforms[0];
  }

  if (platform.includes('linux') || userAgent.includes('linux')) {
    return downloadPlatforms.find((item) => item.key === 'linux-x86_64') ?? downloadPlatforms[0];
  }

  return downloadPlatforms[0];
}

function getDownloadPlatformLabel(key: DownloadPlatform['key']) {
  switch (key) {
    case 'windows-x86_64':
      return translate({message: 'Windows x86_64'});
    case 'linux-x86_64':
      return translate({message: 'Linux x86_64'});
    case 'darwin-x86_64':
      return translate({message: 'macOS Intel'});
    case 'darwin-aarch64':
      return translate({message: 'macOS Apple Silicon'});
    default:
      return key;
  }
}

function DownloadButton() {
  const [platform, setPlatform] = useState<DownloadPlatform>(downloadPlatforms[0]);

  useEffect(() => {
    const detectedPlatform = detectDownloadPlatform();
    setPlatform(detectedPlatform);

    const userAgentData = (
      navigator as Navigator & {
        userAgentData?: {
          platform?: string;
          getHighEntropyValues?: (hints: string[]) => Promise<{architecture?: string; platform?: string}>;
        };
      }
    ).userAgentData;

    const entropyPromise = userAgentData?.getHighEntropyValues?.(['architecture', 'platform']);

    entropyPromise
      ?.then((values) => {
        const detectedOs = values.platform?.toLowerCase() ?? userAgentData.platform?.toLowerCase() ?? '';
        const architecture = values.architecture?.toLowerCase() ?? '';

        if (detectedOs.includes('mac') && ['arm', 'arm64', 'aarch64'].includes(architecture)) {
          const appleSilicon = downloadPlatforms.find((item) => item.key === 'darwin-aarch64');
          if (appleSilicon) {
            setPlatform(appleSilicon);
          }
        }
      })
      .catch(() => {
        // The synchronous detector above is sufficient when high entropy hints are unavailable.
      });
  }, []);

  return (
    <div className={styles.downloadGroup}>
      <a className={clsx('button button--lg', styles.secondaryButton, styles.downloadPrimary)} href={platform.href}>
        <Translate>下载</Translate>
        <span className={styles.downloadPlatform}>{getDownloadPlatformLabel(platform.key)}</span>
      </a>
      <details className={styles.downloadMenu}>
        <summary className={styles.downloadMenuToggle} aria-label={translate({message: '选择下载平台'})}>
          <span />
        </summary>
        <div className={styles.downloadMenuList}>
          {downloadPlatforms.map((item) => (
            <a key={item.key} className={styles.downloadMenuItem} href={item.href}>
              {getDownloadPlatformLabel(item.key)}
            </a>
          ))}
        </div>
      </details>
    </div>
  );
}

function FeaturePreview({
  title,
  lightImage,
  darkImage,
}: {
  title: string;
  lightImage: string;
  darkImage: string;
}) {
  const lightImageUrl = useBaseUrl(lightImage);
  const darkImageUrl = useBaseUrl(darkImage);

  return (
    <div className={styles.featurePreview} aria-label={title}>
      <div className={clsx(styles.featurePreviewImageSlot, styles.featurePreviewLight)}>
        <img
          className={styles.featurePreviewImage}
          src={lightImageUrl}
          alt={translate({message: 'NyaTerm 日间主题功能截图'})}
        />
      </div>
      <div className={clsx(styles.featurePreviewImageSlot, styles.featurePreviewDark)}>
        <img
          className={styles.featurePreviewImage}
          src={darkImageUrl}
          alt={translate({message: 'NyaTerm 夜间主题功能截图'})}
        />
      </div>
    </div>
  );
}

function HeroPreview({
  lightImage,
  darkImage,
}: {
  lightImage: string;
  darkImage: string;
}) {
  const lightImageUrl = useBaseUrl(lightImage);
  const darkImageUrl = useBaseUrl(darkImage);

  return (
    <div className={styles.heroPreview} aria-label={translate({message: '产品截图预览'})}>
      <div className={styles.heroScreenshotStage}>
        <div className={clsx(styles.heroScreenshotSlot, styles.heroScreenshotLight)}>
          <img
            className={styles.heroScreenshotImage}
            src={lightImageUrl}
            alt={translate({message: 'NyaTerm 日间主题产品截图'})}
          />
        </div>
        <div className={clsx(styles.heroScreenshotSlot, styles.heroScreenshotDark)}>
          <img
            className={styles.heroScreenshotImage}
            src={darkImageUrl}
            alt={translate({message: 'NyaTerm 夜间主题产品截图'})}
          />
        </div>
      </div>
    </div>
  );
}

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  const logoUrl = useBaseUrl('/img/logo.svg');

  const badges = [
    translate({message: 'SSH'}),
    translate({message: 'Local Shell'}),
    translate({message: 'Telnet / Serial'}),
    translate({message: 'SFTP'}),
    translate({message: 'WebDAV / S3'}),
  ];

  return (
    <header className={styles.heroBanner}>
      <div className="container">
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <div className={styles.heroBrandRow}>
              <img src={logoUrl} alt="NyaTerm Logo" className={styles.heroLogo} />
              <div className={styles.heroBrandText}>
                <Heading as="h1" className={styles.heroTitle}>
                  {siteConfig.title}
                </Heading>
              </div>
            </div>

            <p className={styles.heroSubtitle}>
              <Translate>用于 SSH、串口和本地命令行工作的桌面终端客户端。</Translate>
            </p>
            <p className={styles.heroDescription}>
              <Translate>
                NyaTerm 将终端会话、远程文件、认证信息、端口转发和配置备份放在同一个桌面应用中，适合日常开发、服务器维护和设备调试。
              </Translate>
            </p>

            <div className={styles.heroButtons}>
              <Link
                className={clsx('button button--lg', styles.primaryButton)}
                to="/docs/getting-started/quick-start">
                <Translate>快速开始</Translate>
              </Link>
              <DownloadButton />
            </div>

            <div className={styles.heroBadges}>
              {badges.map((badge) => (
                <span key={badge} className={styles.heroBadge}>
                  {badge}
                </span>
              ))}
            </div>
          </div>

          <HeroPreview lightImage="/img/home/product-light.png" darkImage="/img/home/product-dark.png" />
        </div>
      </div>
    </header>
  );
}

function FeaturesSection({features}: {features: FeatureTab[]}) {
  const [activeValue, setActiveValue] = useState(features[0]?.value ?? '');
  const [autoplayStopped, setAutoplayStopped] = useState(false);

  const activeIndex = Math.max(
    0,
    features.findIndex((feature) => feature.value === activeValue),
  );
  const activeFeature = features[activeIndex] ?? features[0];
  const isAutoplaying = !autoplayStopped && features.length > 1;

  const stopAutoplay = useCallback(() => {
    setAutoplayStopped(true);

    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(featureAutoplayStoppedKey, 'true');
    }
  }, []);

  const selectFeature = useCallback(
    (value: string) => {
      stopAutoplay();
      setActiveValue(value);
    },
    [stopAutoplay],
  );

  const selectFeatureByOffset = useCallback(
    (offset: number) => {
      const nextIndex = (activeIndex + offset + features.length) % features.length;
      const nextValue = features[nextIndex]?.value;

      if (nextValue) {
        selectFeature(nextValue);
      }
    },
    [activeIndex, features, selectFeature],
  );

  useEffect(() => {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    setAutoplayStopped(sessionStorage.getItem(featureAutoplayStoppedKey) === 'true');
  }, []);

  useEffect(() => {
    if (!features.some((feature) => feature.value === activeValue)) {
      setActiveValue(features[0]?.value ?? '');
    }
  }, [activeValue, features]);

  useEffect(() => {
    if (autoplayStopped) {
      return;
    }

    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mediaQuery?.matches) {
      setAutoplayStopped(true);
      return;
    }

    const stopOnUserAction = () => stopAutoplay();
    const listenerOptions: AddEventListenerOptions = {passive: true};

    window.addEventListener('pointerdown', stopOnUserAction, listenerOptions);
    window.addEventListener('keydown', stopOnUserAction);
    window.addEventListener('wheel', stopOnUserAction, listenerOptions);
    window.addEventListener('touchstart', stopOnUserAction, listenerOptions);

    return () => {
      window.removeEventListener('pointerdown', stopOnUserAction);
      window.removeEventListener('keydown', stopOnUserAction);
      window.removeEventListener('wheel', stopOnUserAction);
      window.removeEventListener('touchstart', stopOnUserAction);
    };
  }, [autoplayStopped, stopAutoplay]);

  useEffect(() => {
    if (!isAutoplaying) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveValue((currentValue) => {
        const currentIndex = features.findIndex((feature) => feature.value === currentValue);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % features.length : 0;
        return features[nextIndex]?.value ?? currentValue;
      });
    }, featureAutoplayIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [features, isAutoplaying]);

  if (!activeFeature) {
    return null;
  }

  return (
    <section id="features" className={styles.featuresSection}>
      <div className="container">
        <div className={styles.featureShowcase}>
          <div className={styles.featureTabs} role="tablist" aria-label={translate({message: '功能展示'})}>
            {features.map((feature, index) => {
              const isActive = feature.value === activeFeature.value;

              return (
                <button
                  key={feature.value}
                  type="button"
                  role="tab"
                  id={`feature-tab-${feature.value}`}
                  aria-controls={`feature-panel-${feature.value}`}
                  aria-selected={isActive}
                  className={clsx(styles.featureTab, isActive && styles.featureTabActive)}
                  onClick={() => selectFeature(feature.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      selectFeatureByOffset(1);
                    }

                    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      selectFeatureByOffset(-1);
                    }

                    if (event.key === 'Home') {
                      event.preventDefault();
                      selectFeature(features[0]?.value ?? feature.value);
                    }

                    if (event.key === 'End') {
                      event.preventDefault();
                      selectFeature(features[features.length - 1]?.value ?? feature.value);
                    }
                  }}>
                  <span className={styles.featureTabIndex}>{String(index + 1).padStart(2, '0')}</span>
                  <span className={styles.featureTabText}>
                    <span className={styles.featureTabLabel}>{feature.label}</span>
                    <span className={styles.featureTabHint}>{feature.title}</span>
                  </span>
                  <span className={styles.featureTabArrow} aria-hidden="true" />
                  {isActive && isAutoplaying ? <span className={styles.featureTabProgress} /> : null}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`feature-panel-${activeFeature.value}`}
            aria-labelledby={`feature-tab-${activeFeature.value}`}
            className={styles.featurePanel}>
            <div className={styles.featureCopy}>
              <Heading as="h2" className={styles.featureTitle}>
                {activeFeature.title}
              </Heading>
              <p className={styles.featureDescription}>{activeFeature.description}</p>
              <ul className={styles.featureList}>
                {activeFeature.bullets.map((bullet) => (
                  <li key={bullet} className={styles.featureListItem}>
                    {bullet}
                  </li>
                ))}
              </ul>
            </div>

            <FeaturePreview
              title={activeFeature.title}
              lightImage={activeFeature.lightImage}
              darkImage={activeFeature.darkImage}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function JourneySection() {
  const steps = [
    {
      title: translate({message: '安装并建立第一个连接'}),
      description: translate({message: '了解安装方式、创建连接和进入工作区的基本流程。'}),
      to: '/docs/getting-started/quick-start',
      label: translate({message: '查看快速开始'}),
    },
    {
      title: translate({message: '按功能查阅使用说明'}),
      description: translate({message: '查看 SSH、SFTP、终端操作、OTP、主题、代理和同步备份的具体用法。'}),
      to: '/docs/',
      label: translate({message: '查看文档'}),
    },
    {
      title: translate({message: '查看版本变化'}),
      description: translate({message: '了解各版本新增功能、行为调整和需要注意的兼容性变化。'}),
      to: '/changelog',
      label: translate({message: '查看更新记录'}),
    },
  ];

  return (
    <section className={styles.journeySection}>
      <div className="container">
        <div className={styles.sectionHeading}>
          <Heading as="h2" className={styles.sectionTitle}>
            <Translate>继续了解 NyaTerm</Translate>
          </Heading>
        </div>

        <div className={styles.journeyGrid}>
          {steps.map((step) => (
            <article key={step.title} className={styles.journeyCard}>
              <Heading as="h3" className={styles.journeyTitle}>
                {step.title}
              </Heading>
              <p className={styles.journeyDescription}>{step.description}</p>
              <Link className={styles.inlineLink} to={step.to}>
                {step.label}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): React.ReactElement {
  const overviewCards: SummaryCard[] = [
    {
      title: translate({message: '多种终端会话'}),
      description: translate({message: '支持 SSH、本地 shell、Telnet 和串口会话，可在标签页和分屏中同时工作。'}),
    },
    {
      title: translate({message: '终端输出阅读'}),
      description: translate({message: '提供搜索、命令历史建议、时间戳、关键词高亮和大输出保护。'}),
    },
    {
      title: translate({message: '文件、认证与网络'}),
      description: translate({message: '包含 SFTP、OTP、代理、跳板机、端口转发和主机密钥校验。'}),
    },
    {
      title: translate({message: '配置同步与备份'}),
      description: translate({message: '可通过 WebDAV 或 S3 兼容存储保存加密配置快照。'}),
    },
  ];

  const featureTabs: FeatureTab[] = [
    {
      value: 'workspace',
      label: translate({message: '工作区'}),
      title: translate({message: '在一个工作区中组织多种会话'}),
      description: translate({message: 'SSH、本地 shell、Telnet 和串口会话使用同一套标签页与分屏布局，便于同时查看不同主机、设备或任务。'}),
      bullets: [
        translate({message: '用标签页区分不同连接、任务或环境'}),
        translate({message: '在单个标签页内横向或纵向拆分终端区域'}),
        translate({message: '在侧边区域查看会话列表、文件和资源信息'}),
      ],
      lightImage: '/img/home/overview-light.png',
      darkImage: '/img/home/overview-dark.png',
    },
    {
      value: 'terminal',
      label: translate({message: '终端'}),
      title: translate({message: '改进命令输入和输出阅读'}),
      description: translate({message: '终端区域提供搜索、命令历史建议和输出标记，减少在长日志、重复命令和排错信息之间来回查找的成本。'}),
      bullets: [
        translate({message: '根据历史命令提供输入建议'}),
        translate({message: '支持终端内搜索、选中文本搜索和翻译'}),
        translate({message: '可显示时间戳、动作链接和关键词高亮'}),
      ],
      lightImage: '/img/home/terminal-light.png',
      darkImage: '/img/home/terminal-dark.png',
    },
    {
      value: 'files',
      label: translate({message: '文件传输'}),
      title: translate({message: '在终端旁处理远程文件'}),
      description: translate({message: 'SFTP 文件浏览器与终端工作区并列使用，适合查看日志、上传构建产物或调整远程配置文件。'}),
      bullets: [
        translate({message: '支持上传、下载、重命名、移动、删除和属性查看'}),
        translate({message: '传输任务可暂停、继续、取消和失败重试'}),
        translate({message: '本地编辑文件后可自动回传到远端路径'}),
      ],
      lightImage: '/img/home/files-light.png',
      darkImage: '/img/home/files-dark.png',
    },
    {
      value: 'security',
      label: translate({message: '安全与网络'}),
      title: translate({message: '管理连接认证和网络访问方式'}),
      description: translate({message: '围绕 SSH 连接所需的凭据、主机校验、一次性口令、代理和端口转发提供统一配置入口。'}),
      bullets: [
        translate({message: '保存密码、私钥和 known hosts，并使用本地加密存储'}),
        translate({message: '支持 TOTP / HOTP、二维码导入和 SSH 登录自动填充'}),
        translate({message: '配置代理、跳板机、本地转发、远程转发和动态转发'}),
      ],
      lightImage: '/img/home/security-light.png',
      darkImage: '/img/home/security-dark.png',
    },
    {
      value: 'sync',
      label: translate({message: '同步与备份'}),
      title: translate({message: '同步和恢复可移植配置'}),
      description: translate({message: 'NyaTerm 可将连接、凭据配置和常用设置打包为加密快照，用于备份、迁移或在多台设备之间同步。'}),
      bullets: [
        translate({message: '支持 WebDAV 和 S3 兼容存储'}),
        translate({message: '使用主密码保护同步和备份数据'}),
        translate({message: '支持 `.dgfy` 导入导出，并处理远端与本地版本冲突'}),
      ],
      lightImage: '/img/home/sync-light.png',
      darkImage: '/img/home/sync-dark.png',
    },
  ];

  return (
    <Layout
      title={translate({message: '首页'})}
      description={translate({message: '支持 SSH、串口、本地 shell、SFTP 和配置备份的桌面终端客户端'})}>
      <HomepageHeader />
      <main>
        <FeaturesSection features={featureTabs} />
        <JourneySection />
      </main>
    </Layout>
  );
}
