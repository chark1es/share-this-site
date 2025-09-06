import React, { useMemo, useState } from 'react';
import {
  Button,
  Group,
  Stack,
  TextInput,
  SegmentedControl,
  Code,
  Card,
  Text,
  CopyButton,
  Tooltip,
  Badge,
  Divider,
  Alert,
  Loader,
  NumberInput,
  Select,
  ActionIcon
} from '@mantine/core';
import { IconLink, IconCheck, IconCopy, IconAlertCircle, IconClipboard, IconX } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

function ttlOptions() {
  return [
    { value: '15', label: '15m' },
    { value: '60', label: '1h' },
    { value: '360', label: '6h' },
    { value: '1440', label: '24h' },
    { value: '10080', label: '7d' },
    { value: 'custom', label: 'Custom' },
  ];
}

export default function LinkCreator() {
  const [url, setUrl] = useState('');
  const [ttl, setTtl] = useState('60');
  const [customTime, setCustomTime] = useState(60);
  const [customUnit, setCustomUnit] = useState('minutes');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [result, setResult] = useState<null | { key: string; shortUrl: string; url: string; expireAt: string }>(null);

  const finalTtl = useMemo(() => {
    if (ttl === 'custom') {
      const multiplier = customUnit === 'minutes' ? 1 : customUnit === 'hours' ? 60 : 1440;
      return customTime * multiplier;
    }
    return Number(ttl);
  }, [ttl, customTime, customUnit]);

  function validateUrl(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return 'Enter a URL';
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const u = new URL(candidate);
      // Require a dot and at least two letters after the last dot
      if (!/\.[a-zA-Z]{2,}(?:[:/]|$)/.test(u.host + u.pathname)) {
        return 'Use a valid domain (e.g. example.com)';
      }
      return null;
    } catch {
      return 'Enter a valid URL';
    }
  }

  const disabled = useMemo(() => loading || !url.trim() || !!inputError, [loading, url, inputError]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);

    // Basic validation
    const earlyErr = validateUrl(url);
    if (earlyErr) {
      setInputError(earlyErr);
      setLoading(false);
      notifications.show({ title: 'Invalid URL', message: earlyErr, color: 'red', icon: <IconAlertCircle size={16} /> });
      return;
    }

    // Normalize URL: prepend https:// if missing a scheme
    const normalizedUrl = (() => {
      const trimmed = url.trim();
      if (!trimmed) return '';
      if (/^https?:\/\//i.test(trimmed)) return trimmed;
      return `https://${trimmed}`;
    })();

    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl, ttlMinutes: finalTtl }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || 'Failed to create link');

      setResult(data);
      notifications.show({
        title: 'Success!',
        message: 'Your temporary link has been created',
        color: 'teal',
        icon: <IconCheck size={16} />,
      });
    } catch (err: any) {
      const errorMessage = err?.message || 'Something went wrong';
      setError(errorMessage);
      notifications.show({
        title: 'Error',
        message: errorMessage,
        color: 'red',
        icon: <IconAlertCircle size={16} />,
      });
    } finally {
      setLoading(false);
    }
  }

  const handleCopy = () => {
    notifications.show({
      title: 'Copied!',
      message: 'Link copied to clipboard',
      color: 'blue',
      icon: <IconCopy size={16} />,
    });
  };

  return (
    <div className="animate-fade-in">
      <Stack gap="lg">
        <Card
          withBorder
          radius="lg"
          p="lg"
          shadow="md"
          className="bg-white border-gray-200 hover:shadow-lg transition-shadow duration-200 sm:p-2xl"
        >
          <form onSubmit={handleSubmit}>
            <Stack gap="xl" className="sm:gap-2xl">
              <TextInput
                label="Destination URL"
                description="Enter the URL you want to shorten. We'll add https:// if needed."
                placeholder="https://example.com/your-long-url"
                value={url}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setUrl(v);
                  setInputError(validateUrl(v));
                }}
                required
                size="lg"
                aria-describedby="url-help"
                error={inputError || undefined}
                leftSection={<IconLink size={20} />}
                rightSectionWidth={72}
                rightSection={
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label="Paste from clipboard" withArrow>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        aria-label="Paste from clipboard"
                        onClick={async () => {
                          try {
                            const text = await navigator.clipboard.readText();
                            if (text) setUrl(text);
                          } catch { }
                        }}
                      >
                        <IconClipboard size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {url && (
                      <Tooltip label="Clear" withArrow>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          color="gray"
                          aria-label="Clear URL"
                          onClick={() => setUrl('')}
                        >
                          <IconX size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                }
                className="transition-all duration-200"
                styles={{
                  input: {
                    '&:focus': {
                      borderColor: 'var(--mantine-color-blue-6)',
                      boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.1)',
                    },
                  },
                }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !disabled) {
                    (e.target as HTMLInputElement).form?.requestSubmit();
                  }
                }}
              />
              <Text id="url-help" size="sm" c="dimmed" className="-mt-2">
                Tip: Press Ctrl/⌘ + Enter to create the link
              </Text>

              <fieldset className="w-full" aria-describedby="ttl-help">
                <legend className="sr-only">Choose how long the link should remain active</legend>
                <Stack gap="md" align="center">
                  <Text id="ttl-help" size="md" fw={500} className="text-gray-700">
                    Link expires after
                  </Text>
                  <SegmentedControl
                    value={ttl}
                    onChange={(v) => setTtl(v)}
                    data={ttlOptions()}
                    size="lg"
                    className="w-full max-w-md"
                  />

                  {ttl === 'custom' && (
                    <Group gap="md" className="w-full max-w-md" align="end">
                      <NumberInput
                        label="Duration"
                        placeholder="Enter time"
                        value={customTime}
                        onChange={(val) => setCustomTime(Number(val) || 1)}
                        min={1}
                        max={customUnit === 'minutes' ? 10080 : customUnit === 'hours' ? 168 : 7}
                        size="md"
                        className="flex-1"
                      />
                      <Select
                        label="Unit"
                        value={customUnit}
                        onChange={(val) => setCustomUnit(val || 'minutes')}
                        data={[
                          { value: 'minutes', label: 'Minutes' },
                          { value: 'hours', label: 'Hours' },
                          { value: 'days', label: 'Days' },
                        ]}
                        size="md"
                        w={160}
                        comboboxProps={{ width: 200, position: 'bottom-start' }}
                      />
                    </Group>
                  )}
                </Stack>
              </fieldset>

              <Stack align="center" className="w-full">
                <Button
                  type="submit"
                  loading={loading}
                  disabled={disabled}
                  size="lg"
                  leftSection={loading ? <Loader size={18} /> : <IconLink size={18} />}
                  className="w-full max-w-md"
                  color="blue"
                >
                  {loading ? 'Creating...' : 'Create Link'}
                </Button>
              </Stack>
            </Stack>
          </form>
        </Card>

        {error && (
          <Alert
            color="red"
            title="Error"
            icon={<IconAlertCircle size={18} />}
            className="animate-slide-up"
            radius="lg"
            p="lg"
          >
            {error}
          </Alert>
        )}

        {result && (
          <Card
            withBorder
            radius="lg"
            p="xl"
            shadow="md"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="bg-white border-gray-200 animate-slide-up sm:p-2xl"
          >
            <Stack gap="xl">
              <Group gap="md" align="center" className="justify-center sm:justify-start">
                <Badge
                  color="teal"
                  variant="light"
                  size="xl"
                  leftSection={<IconCheck size={16} />}
                  className="px-4 py-2"
                >
                  Success
                </Badge>
                <Text c="dimmed" size="md" className="font-medium">
                  Your temporary link is ready!
                </Text>
              </Group>

              <Stack gap="lg" className="sm:hidden">
                <Code
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg font-mono text-sm break-all"
                >
                  {result.shortUrl}
                </Code>
                <CopyButton value={result.shortUrl} timeout={2000}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? 'Copied!' : 'Copy link'} withArrow>
                      <Button
                        onClick={() => {
                          copy();
                          handleCopy();
                        }}
                        variant="light"
                        color={copied ? 'teal' : 'blue'}
                        leftSection={copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
                        className="transition-all duration-200 w-full"
                        size="md"
                      >
                        {copied ? 'Copied!' : 'Copy'}
                      </Button>
                    </Tooltip>
                  )}
                </CopyButton>
              </Stack>
              <Group wrap="wrap" align="center" gap="lg" className="hidden sm:flex">
                <Code
                  className="flex-1 min-w-0 p-4 bg-gray-50 border border-gray-200 rounded-lg font-mono text-base break-all"
                >
                  {result.shortUrl}
                </Code>
                <CopyButton value={result.shortUrl} timeout={2000}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? 'Copied!' : 'Copy link'} withArrow>
                      <Button
                        onClick={() => {
                          copy();
                          handleCopy();
                        }}
                        variant="light"
                        color={copied ? 'teal' : 'blue'}
                        leftSection={copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
                        className="transition-all duration-200"
                        size="lg"
                      >
                        {copied ? 'Copied!' : 'Copy'}
                      </Button>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>

              <Divider className="my-6" />

              <Stack gap="lg">
                <Stack gap="md" className="sm:hidden">
                  <Text size="sm" c="dimmed" fw={500}>
                    <strong>Destination:</strong>
                  </Text>
                  <Code className="bg-gray-100 px-3 py-2 rounded-lg text-sm break-all">
                    {result.url}
                  </Code>
                  <Text size="sm" c="dimmed" fw={500}>
                    <strong>Expires:</strong> {new Date(result.expireAt).toLocaleString()}
                  </Text>
                </Stack>
                <div className="hidden sm:block space-y-4">
                  <Text size="md" c="dimmed" className="flex items-center gap-3 flex-wrap">
                    <strong>Destination:</strong>
                    <Code className="bg-gray-100 px-3 py-2 rounded-lg break-all">
                      {result.url}
                    </Code>
                  </Text>
                  <Text size="md" c="dimmed" fw={500}>
                    <strong>Expires:</strong> {new Date(result.expireAt).toLocaleString()}
                  </Text>
                </div>
              </Stack>
            </Stack>
          </Card>
        )}
      </Stack>
    </div>
  );
}

