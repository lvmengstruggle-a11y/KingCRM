-- 工单模块。在 kingcrm 手工执行。不改已有业务表，只新增工单表并给默认组织登记模块开关。

CREATE TABLE IF NOT EXISTS `ticket` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `number` varchar(32) NOT NULL,
  `title` varchar(255) NOT NULL,
  `template_id` varchar(32) NOT NULL,
  `status_id` varchar(32) NOT NULL,
  `priority` tinyint NOT NULL DEFAULT 1,
  `publisher_id` varchar(32) NOT NULL,
  `recipient_id` varchar(32) DEFAULT NULL,
  `handler_id` varchar(32) DEFAULT NULL,
  `department_id` varchar(32) DEFAULT NULL,
  `customer_id` varchar(32) DEFAULT NULL,
  `contract_id` varchar(32) DEFAULT NULL,
  `order_id` varchar(32) DEFAULT NULL,
  `mobile` varchar(32) DEFAULT NULL,
  `mail` varchar(128) DEFAULT NULL,
  `guest_name` varchar(64) DEFAULT NULL,
  `source` varchar(16) NOT NULL DEFAULT 'PC',
  `deadline` bigint DEFAULT NULL,
  `end_time` bigint DEFAULT NULL,
  `recycled` tinyint NOT NULL DEFAULT 0,
  `recycle_user` varchar(32) DEFAULT NULL,
  `recycle_time` bigint DEFAULT NULL,
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ticket_org_number` (`organization_id`, `number`),
  KEY `idx_ticket_org_recycled` (`organization_id`, `recycled`, `create_time`),
  KEY `idx_ticket_publisher` (`organization_id`, `publisher_id`, `recycled`),
  KEY `idx_ticket_handler` (`organization_id`, `handler_id`, `recycled`),
  KEY `idx_ticket_department` (`organization_id`, `department_id`, `recycled`),
  KEY `idx_ticket_customer` (`organization_id`, `customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_template` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `name` varchar(100) NOT NULL,
  `enable` tinyint NOT NULL DEFAULT 1,
  `pos` int NOT NULL DEFAULT 1,
  `enable_customer` tinyint NOT NULL DEFAULT 0,
  `enable_cc` tinyint NOT NULL DEFAULT 0,
  `enable_handler` tinyint NOT NULL DEFAULT 0,
  `enable_deadline` tinyint NOT NULL DEFAULT 0,
  `enable_mobile` tinyint NOT NULL DEFAULT 0,
  `mobile_required` tinyint NOT NULL DEFAULT 0,
  `enable_mail` tinyint NOT NULL DEFAULT 0,
  `mail_required` tinyint NOT NULL DEFAULT 0,
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_template_org` (`organization_id`, `enable`, `pos`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_status` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `name` varchar(50) NOT NULL,
  `color` varchar(16) NOT NULL DEFAULT '#3290f9',
  `pos` int NOT NULL,
  `is_initial` tinyint NOT NULL DEFAULT 0,
  `is_terminal` tinyint NOT NULL DEFAULT 0,
  `stop_timing` tinyint NOT NULL DEFAULT 0,
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_status_org` (`organization_id`, `pos`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_route` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `template_id` varchar(32) NOT NULL,
  `department_id` varchar(32) NOT NULL,
  `last_handler_id` varchar(32) DEFAULT NULL,
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ticket_route_template` (`organization_id`, `template_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_config` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `default_department_id` varchar(32) DEFAULT NULL,
  `last_handler_id` varchar(32) DEFAULT NULL,
  `handler_can_close` tinyint NOT NULL DEFAULT 1,
  `publisher_can_close` tinyint NOT NULL DEFAULT 1,
  `reply_after_close` tinyint NOT NULL DEFAULT 0,
  `allow_status_back` tinyint NOT NULL DEFAULT 0,
  `notify_assign` tinyint NOT NULL DEFAULT 1,
  `notify_reply_publisher` tinyint NOT NULL DEFAULT 1,
  `notify_reply_handler` tinyint NOT NULL DEFAULT 1,
  `notify_reply_cc` tinyint NOT NULL DEFAULT 1,
  `notify_reply_follow` tinyint NOT NULL DEFAULT 1,
  `notify_internal_handler` tinyint NOT NULL DEFAULT 1,
  `notify_status_publisher` tinyint NOT NULL DEFAULT 0,
  `notify_close_publisher` tinyint NOT NULL DEFAULT 0,
  `notify_restart_handler` tinyint NOT NULL DEFAULT 1,
  `satisfy_enabled` tinyint NOT NULL DEFAULT 1,
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ticket_config_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_field` (
  `id` varchar(32) NOT NULL,
  `resource_id` varchar(32) NOT NULL,
  `field_id` varchar(32) NOT NULL,
  `field_value` varchar(1000) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ticket_field` (`resource_id`, `field_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_field_blob` (
  `id` varchar(32) NOT NULL,
  `resource_id` varchar(32) NOT NULL,
  `field_id` varchar(32) NOT NULL,
  `field_value` mediumtext NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ticket_field_blob` (`resource_id`, `field_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_reply` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `ticket_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `content` text NOT NULL,
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_reply` (`ticket_id`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_internal_reply` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `ticket_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `content` text NOT NULL,
  `mention_user_ids` varchar(1000) NOT NULL DEFAULT '',
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_internal_reply` (`ticket_id`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_cc` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `ticket_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ticket_cc` (`ticket_id`, `user_id`),
  KEY `idx_ticket_cc_user` (`organization_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_participant` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `ticket_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ticket_participant` (`ticket_id`, `user_id`),
  KEY `idx_ticket_participant_user` (`organization_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_follow` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `ticket_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ticket_follow` (`ticket_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_event` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `ticket_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `event_type` varchar(32) NOT NULL,
  `reply_id` varchar(32) DEFAULT NULL,
  `status_id` varchar(32) DEFAULT NULL,
  `priority` tinyint DEFAULT NULL,
  `target_user_id` varchar(32) DEFAULT NULL,
  `content` varchar(1000) NOT NULL DEFAULT '',
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_event` (`ticket_id`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_file` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `ticket_id` varchar(32) NOT NULL,
  `reply_id` varchar(32) DEFAULT NULL,
  `internal_reply_id` varchar(32) DEFAULT NULL,
  `file_id` varchar(32) NOT NULL,
  `file_name` varchar(255) NOT NULL DEFAULT '',
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_file` (`ticket_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ticket_satisfy` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `ticket_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `score` tinyint NOT NULL,
  `advice` varchar(1000) NOT NULL DEFAULT '',
  `create_time` bigint NOT NULL,
  `update_time` bigint NOT NULL,
  `create_user` varchar(32) NOT NULL,
  `update_user` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ticket_satisfy` (`ticket_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET @now = UNIX_TIMESTAMP() * 1000;

INSERT INTO ticket_status (id, organization_id, name, color, pos, is_initial, is_terminal, stop_timing, create_time, update_time, create_user, update_user)
SELECT 'ts1000010000000000000000000001', '100001', '待处理', '#b8d900', 1, 1, 0, 0, @now, @now, 'admin', 'admin'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM ticket_status WHERE organization_id = '100001');

INSERT INTO ticket_status (id, organization_id, name, color, pos, is_initial, is_terminal, stop_timing, create_time, update_time, create_user, update_user)
SELECT 'ts1000010000000000000000000002', '100001', '处理中', '#3290f9', 2, 0, 0, 0, @now, @now, 'admin', 'admin'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM ticket_status WHERE id = 'ts1000010000000000000000000002');

INSERT INTO ticket_status (id, organization_id, name, color, pos, is_initial, is_terminal, stop_timing, create_time, update_time, create_user, update_user)
SELECT 'ts1000010000000000000000000003', '100001', '待确认', '#9c2189', 3, 0, 0, 0, @now, @now, 'admin', 'admin'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM ticket_status WHERE id = 'ts1000010000000000000000000003');

INSERT INTO ticket_status (id, organization_id, name, color, pos, is_initial, is_terminal, stop_timing, create_time, update_time, create_user, update_user)
SELECT 'ts1000010000000000000000000004', '100001', '已完成', '#00b5ad', 4, 0, 1, 0, @now, @now, 'admin', 'admin'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM ticket_status WHERE id = 'ts1000010000000000000000000004');

INSERT INTO ticket_template (id, organization_id, name, enable, pos, enable_customer, enable_cc, enable_handler, enable_deadline, enable_mobile, mobile_required, enable_mail, mail_required, create_time, update_time, create_user, update_user)
SELECT 'tt1000010000000000000000000001', '100001', '默认模板', 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, @now, @now, 'admin', 'admin'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM ticket_template WHERE organization_id = '100001');

INSERT INTO ticket_config (id, organization_id, default_department_id, last_handler_id, handler_can_close, publisher_can_close, reply_after_close, allow_status_back, notify_assign, notify_reply_publisher, notify_reply_handler, notify_reply_cc, notify_reply_follow, notify_internal_handler, notify_status_publisher, notify_close_publisher, notify_restart_handler, satisfy_enabled, create_time, update_time, create_user, update_user)
SELECT 'tc1000010000000000000000000001', '100001',
  (SELECT id FROM sys_department WHERE organization_id = '100001' ORDER BY pos LIMIT 1),
  NULL, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, @now, @now, 'admin', 'admin'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM ticket_config WHERE organization_id = '100001');

SET @ticket_pos = (SELECT IFNULL(MAX(pos), 0) + 1 FROM sys_module WHERE organization_id = '100001');

INSERT INTO sys_module (id, organization_id, module_key, enable, pos, create_user, create_time, update_user, update_time)
SELECT 'md1000010000000000000000000001', '100001', 'ticket', 1, @ticket_pos, 'admin', @now, 'admin', @now
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM sys_module WHERE organization_id = '100001' AND module_key = 'ticket');

SET @guest_col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket' AND COLUMN_NAME = 'guest_name'
);
SET @guest_sql = IF(
  @guest_col = 0,
  'ALTER TABLE `ticket` ADD COLUMN `guest_name` varchar(64) DEFAULT NULL AFTER `mail`',
  'SELECT 1'
);
PREPARE guest_stmt FROM @guest_sql;
EXECUTE guest_stmt;
DEALLOCATE PREPARE guest_stmt;
