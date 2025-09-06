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
  Loader
} from '@mantine/core';
import { IconLink, IconCheck, IconCopy, IconAlertCircle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

function ttlOptions() {
  return [
    { value: '15', label: '15m' },
    { value: '60', label: '1h' },
    { value: '360', label: '6h' },
    { value: '1440', label: '24h' },
    { value: '10080', label: '7d' },
  ];
}

export default function LinkCreator() {
  const [url, setUrl] = useState('');
  const [ttl, setTtl] = useState('60');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<null | { key: string; shortUrl: string; url: string; expireAt: string }>(null);
  const disabled = useMemo(() => loading || !url.trim(), [loading, url]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, ttlMinutes: Number(ttl) }),
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
          p="md"
          shadow="md"
          className="bg-white border-gray-200 hover:shadow-lg transition-shadow duration-200 sm:p-xl"
        >
          <form onSubmit={handleSubmit}>
            <Stack gap="md" className="sm:gap-lg">
              <TextInput
                label="Destination URL"
                description="Enter the URL you want to shorten. We'll add https:// if needed."
                placeholder="https://example.com/your-long-url"
                value={url}
                onChange={(e) => setUrl(e.currentTarget.value)}
                required
                size="md"
                leftSection={<IconLink size={18} />}
                className="transition-all duration-200"
                styles={{
                  input: {
                    '&:focus': {
                      borderColor: 'var(--mantine-color-blue-6)',
                      boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.1)',
                    },
                  },
                }}
              />

              <Stack gap="xs" align="center" className="w-full">
                <Text size="sm" fw={500} className="text-gray-700">
                  Link expires after
                </Text>
                <SegmentedControl
                  value={ttl}
                  onChange={(v) => setTtl(v)}
                  data={ttlOptions()}
                  size="md"
                  className="w-full max-w-md"
                />
              </Stack>

              <Stack align="center" className="w-full">
                <Button
                  type="submit"
                  loading={loading}
                  disabled={disabled}
                  size="md"
                  leftSection={loading ? <Loader size={16} /> : <IconLink size={16} />}
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
            icon={<IconAlertCircle size={16} />}
            className="animate-slide-up"
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
            className="bg-white border-gray-200 animate-slide-up"
          >
            <Stack gap="md">
              <Group gap="xs" align="center">
                <Badge
                  color="teal"
                  variant="light"
                  size="lg"
                  leftSection={<IconCheck size={14} />}
                >
                  Success
                </Badge>
                <Text c="dimmed" size="sm" className="font-medium">
                  Your temporary link is ready!
                </Text>
              </Group>

              <Stack gap="sm" className="sm:hidden">
                <Code
                  className="w-full p-2 bg-white border border-gray-200 rounded-lg font-mono text-xs break-all"
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
                        leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                        className="transition-all duration-200 w-full"
                        size="sm"
                      >
                        {copied ? 'Copied!' : 'Copy'}
                      </Button>
                    </Tooltip>
                  )}
                </CopyButton>
              </Stack>
              <Group wrap="wrap" align="center" gap="md" className="hidden sm:flex">
                <Code
                  className="flex-1 min-w-0 p-3 bg-white border border-gray-200 rounded-lg font-mono text-sm break-all"
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
                        leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                        className="transition-all duration-200"
                      >
                        {copied ? 'Copied!' : 'Copy'}
                      </Button>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>

              <Divider className="my-2" />

              <Stack gap="xs">
                <Stack gap="xs" className="sm:hidden">
                  <Text size="xs" c="dimmed">
                    <strong>Destination:</strong>
                  </Text>
                  <Code className="bg-gray-100 px-2 py-1 rounded text-xs break-all">
                    {result.url}
                  </Code>
                  <Text size="xs" c="dimmed">
                    <strong>Expires:</strong> {new Date(result.expireAt).toLocaleString()}
                  </Text>
                </Stack>
                <div className="hidden sm:block">
                  <Text size="sm" c="dimmed" className="flex items-center gap-2 flex-wrap">
                    <strong>Destination:</strong>
                    <Code className="bg-gray-100 px-2 py-1 rounded break-all">
                      {result.url}
                    </Code>
                  </Text>
                  <Text size="sm" c="dimmed" className="mt-1">
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

