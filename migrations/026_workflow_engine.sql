BEGIN;

-- Workflow definitions
CREATE TABLE IF NOT EXISTS public.workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workflow nodes (the blocks in the visual builder)
CREATE TABLE IF NOT EXISTS public.workflow_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  node_config JSONB NOT NULL DEFAULT '{}',
  position_x FLOAT NOT NULL DEFAULT 0,
  position_y FLOAT NOT NULL DEFAULT 0,
  label TEXT
);

-- Connections between nodes
CREATE TABLE IF NOT EXISTS public.workflow_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  branch TEXT DEFAULT 'default'
);

-- Workflow executions (runtime instances)
CREATE TABLE IF NOT EXISTS public.workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'paused', 'cancelled')),
  trigger_data JSONB NOT NULL DEFAULT '{}',
  current_node_id UUID REFERENCES public.workflow_nodes(id) ON DELETE SET NULL,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  next_step_at TIMESTAMPTZ
);

-- Step-by-step execution log
CREATE TABLE IF NOT EXISTS public.workflow_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES public.workflow_executions(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  input_data JSONB DEFAULT '{}',
  output_data JSONB DEFAULT '{}',
  error_message TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_tenant ON public.workflows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow ON public.workflow_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_connections_workflow ON public.workflow_connections(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON public.workflow_executions(workflow_id, status);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_tenant ON public.workflow_executions(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_next_step ON public.workflow_executions(next_step_at) WHERE status = 'paused';
CREATE INDEX IF NOT EXISTS idx_workflow_execution_logs_execution ON public.workflow_execution_logs(execution_id, executed_at);

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_nodes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_executions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_execution_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflows: select within tenant" ON public.workflows;
CREATE POLICY "workflows: select within tenant" ON public.workflows
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS "workflow_nodes: select via workflow" ON public.workflow_nodes;
CREATE POLICY "workflow_nodes: select via workflow" ON public.workflow_nodes
  FOR SELECT USING (workflow_id IN (SELECT id FROM public.workflows WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid));

DROP POLICY IF EXISTS "workflow_connections: select via workflow" ON public.workflow_connections;
CREATE POLICY "workflow_connections: select via workflow" ON public.workflow_connections
  FOR SELECT USING (workflow_id IN (SELECT id FROM public.workflows WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid));

DROP POLICY IF EXISTS "workflow_executions: select within tenant" ON public.workflow_executions;
CREATE POLICY "workflow_executions: select within tenant" ON public.workflow_executions
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS "workflow_execution_logs: select via execution" ON public.workflow_execution_logs;
CREATE POLICY "workflow_execution_logs: select via execution" ON public.workflow_execution_logs
  FOR SELECT USING (execution_id IN (SELECT id FROM public.workflow_executions WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid));

COMMIT;
